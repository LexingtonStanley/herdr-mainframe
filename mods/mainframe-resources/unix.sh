#!/bin/sh
# Run as sh unix.sh, or pass the source as a single sh -c argument via Herdr.
export LC_ALL=C
os=${1:-$(uname -s)}
host=$(uname -n)
case "$os" in
Linux)
    [ -r /proc/stat ] && [ -r /proc/meminfo ] || exit 1
    # BusyBox df has no -l. Only real devices (and ZFS/bcachefs datasets) go on to awk, at most 200:
    # the list travels in the environment, and a host with thousands of mounts would overflow it.
    drives=$(df -lkPT 2>/dev/null)
    [ -n "$drives" ] || drives=$(df -kPT 2>/dev/null)
    drives=$(printf '%s\n' "$drives" | awk 'NR == 1 || $1 ~ /^\/dev\// || $2 ~ /^(zfs|bcachefs)$/' | head -n 200)
    if command -v nvidia-smi >/dev/null 2>&1; then
        nvidia=$(nvidia-smi --query-gpu=pci.bus_id,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null) || nvidia=
    fi
    set -- /sys/class/drm/card[0-9]*/device /sys/class/drm/card[0-9]*/device/hwmon/hwmon[0-9]* \
        /sys/class/hwmon/hwmon*/temp*_input /sys/class/thermal/thermal_zone*/temp
    ;;
Darwin)
    cores=$(sysctl -n hw.logicalcpu)
    ram=$(sysctl -n hw.memsize)
    load=$(sysctl -n vm.loadavg)
    boot=$(sysctl -n kern.boottime)
    now=$(date +%s)
    vm=$(vm_stat)
    swap=$(sysctl -n vm.swapusage)
    cpu=$(top -l 2 -s 1 -n 0 | awk '/^CPU usage:/ {line=$0} END {print line}')
    drives=$(df -lkP 2>/dev/null | awk 'NR == 1 || $1 ~ /^\/dev\//' | head -n 200)
    # A bounded registry walk per driver family. Keep only fields we can display.
    gpu=$(for family in IOAccelerator AGXAccelerator; do
        ioreg -r -d 1 -w 0 -c "$family" 2>/dev/null
    done | awk '/<class / || /"model" =/ || /"PerformanceStatistics" =/')
    set --
    ;;
*) exit 1 ;;
esac
export os host drives nvidia cores ram load boot now vm swap cpu gpu
exec awk '
function quote(s,    out,i,c) {
    out="\""
    for (i=1;i<=length(s);i++) {
        c=substr(s,i,1)
        if (c=="\\" || c=="\"") out=out "\\" c
        else if (c in control) out=out control[c]
        else out=out c
    }
    return out "\""
}
function num(s,scale) {
    return (s ~ /^-?[0-9]+([.][0-9]+)?$/) ? (s*scale) : "null"
}
function bytes(s,scale) {return (s ~ /^[0-9]+([.][0-9]+)?$/) ? sprintf("%.0f",s*scale) : "null"}
function line(path,    s) {if ((getline s < path)<=0) s=""; close(path); return s}
function add(list,item) {return list (list=="" ? "" : ",") item}
function pair(u,t,scale) {return "{\"used\":" bytes(u,scale) ",\"total\":" bytes(t,scale) "}"}
function driveRows(    rows,n,i,a,mount,s,start) {
    n=split(ENVIRON["drives"],rows,"\n")
    for (i=2;i<=n;i++) {
        s=rows[i]; sub(/^ +/,"",s)
        # Work from the numeric columns so mount points and device names may contain spaces.
        if (!match(s,/[[:space:]]+[0-9]+[[:space:]]+[0-9]+[[:space:]]+-?[0-9]+[[:space:]]+[0-9]+%[[:space:]]+/)) continue
        start=RSTART; mount=substr(s,RSTART+RLENGTH)
        split(substr(s,start+1),a)
        s=substr(s,1,start-1)
        if (s ~ /^\/dev\/(loop|ram|zram|fd\/)/ || s ~ / (squashfs|overlay|tmpfs|efivarfs|iso9660)$/) continue
        if (s !~ /^\/dev\// && s !~ / (zfs|bcachefs)$/) continue
        if (ENVIRON["os"] == "Darwin") {
            # APFS volumes share their container, so the Used of one volume says little about how
            # full the disk is: show the container (size less free), once, as "/", and leave out
            # the other system volumes.
            if (mount ~ /^\/System\/Volumes\//) continue
            a[2] = a[1] - a[3]
        }
        disks=add(disks,"{\"mount\":" quote(mount) ",\"used\":" bytes(a[2],1024) ",\"total\":" bytes(a[1],1024) "}")
    }
}
function celsius(s,scale,    v) {
    v=num(s,scale); return (v=="null" || v < -40 || v > 150) ? "null" : v
}
function sensor(label,t) {
    if (t!="null") temps=add(temps,"{\"name\":" quote(label) ",\"celsius\":" t "}")
}
function pci(s) {s=tolower(s); sub(/^00000000:/,"0000:",s); return s}
function linuxGpu(path,    f,a,name,v,slot,t,w,busy,card,id,h) {
    split(path,a,"/"); card=a[5]; v=line(path "/vendor")
    f=path "/uevent"
    while ((getline h < f)>0) {
        if (h ~ /^PCI_SLOT_NAME=/) slot=pci(substr(h,15))
        if (h ~ /^PCI_ID=/) id=substr(h,8)
        if (h ~ /^DRIVER=/) name=substr(h,8)
    }
    close(f)
    if (slot in smi) return
    if (name=="" && v=="") return
    if (v=="0x1002") name="AMD"
    if (v=="0x8086") name="Intel"
    if (v=="0x10de") {
        name="NVIDIA"
        f=line("/proc/driver/nvidia/gpus/" slot "/information")
        if (sub(/^Model:[[:space:]]*/,"",f)) name=name " " f
    }
    h=line(path "/product_name")
    name=(h!="" ? h : name (id!="" ? " " id : "")) " (" card ")"
    h=hw[path]; t=w="null"
    if (h!="") {
        t=celsius(line(h "/temp1_input"),0.001)
        f=line(h "/power1_average"); if (f=="") f=line(h "/power1_input")
        w=num(f,0.000001)
    }
    busy=num(line(path "/gpu_busy_percent"),1)
    gpus=add(gpus,"{\"name\":" quote(name) ",\"percent\":" busy ",\"vram\":" pair(line(path "/mem_info_vram_used"),line(path "/mem_info_vram_total"),1) ",\"temp\":" t ",\"watts\":" w "}")
}
function linux(    a,i,n,rows,x,k,path,dir,label,chip,t,available,base) {
    if (split(line("/proc/uptime"),a)) uptime=int(a[1])
    if (split(line("/proc/loadavg"),a)>=3) loads=num(a[1],1) "," num(a[2],1) "," num(a[3],1)
    while ((getline x < "/proc/stat")>0) {
        if (x ~ /^cpu /) {
            split(x,a)
            # guest and guest_nice are already included in user and nice.
            for (k=2;k<=9;k++) total+=a[k]
            idle=a[5]+a[6]
        } else if (x ~ /^cpu[0-9]+ /) cores++
    }
    close("/proc/stat")
    while ((getline x < "/proc/meminfo")>0) {split(x,a); mem[a[1]]=a[2]}
    close("/proc/meminfo")
    available=mem["MemAvailable:"]
    if (available=="") available=mem["MemFree:"]+mem["Buffers:"]+mem["Cached:"]
    memory=pair(sprintf("%.0f",mem["MemTotal:"]-available),mem["MemTotal:"],1024)
    swap=pair(mem["SwapTotal:"]-mem["SwapFree:"],mem["SwapTotal:"],1024)
    n=split(ENVIRON["nvidia"],rows,"\n")
    for (i=1;i<=n;i++) {
        if (split(rows[i],a,/[[:space:]]*,[[:space:]]*/)!=7 || a[1] !~ /:/) continue
        smi[pci(a[1])]=1
        gpus=add(gpus,"{\"name\":" quote(a[2]) ",\"percent\":" num(a[3],1) ",\"vram\":" pair(a[4],a[5],1048576) ",\"temp\":" celsius(a[6],1) ",\"watts\":" num(a[7],1) "}")
    }
    for (i=1;i<ARGC;i++) {
        path=ARGV[i]; dir=path; sub(/\/[^/]+$/,"",dir)
        if (path ~ /\/device\/hwmon\/hwmon[0-9]+$/) {base=path; sub(/\/hwmon\/hwmon[0-9]+$/,"",base); hw[base]=path; continue}
        if (path !~ /_input$/ || path ~ /\*/) continue
        chip=line(dir "/name"); base=path; sub(/_input$/,"_label",base); label=line(base)
        if (label ~ /^(Package id|Tctl|Tdie)/ || chip ~ /^(cpu_thermal|cpu_thermal_zone)$/) {
            t=celsius(line(path),0.001); if (t!="null" && (packageTemp=="null" || t+0>packageTemp+0)) packageTemp=t
        } else if (chip=="nvme" && (label=="Composite" || label=="")) {
            split(dir,a,"/"); sensor("NVMe " a[5],celsius(line(path),0.001))
        }
    }
    for (i=1;i<ARGC;i++) {
        path=ARGV[i]
        if (path ~ /\/card[0-9]+\/device$/) linuxGpu(path)
        if (packageTemp=="null" && path ~ /\/temp$/) {
            dir=path; sub(/\/temp$/,"",dir)
            if (line(dir "/type") ~ /^(x86_pkg_temp|cpu[-_]thermal|cpu[-_]therm)$/) packageTemp=celsius(line(path),0.001)
        }
    }
}
function swapBytes(s,    unit) {
    unit=substr(s,length(s)); sub(/[BKMGT]$/,"",s)
    return bytes(s,1024^index("KMGT",unit))
}
# ioreg prints driver properties as a dictionary. Extract a decimal counter by literal key.
function counter(s,key,    pos) {
    pos=index(s,"\"" key "\"=")
    if (!pos) return "null"
    s=substr(s,pos+length(key)+3)
    return match(s,/^[0-9]+([.][0-9]+)?[,}]/) ? substr(s,1,RLENGTH-1) : "null"
}
function macGpu(    rows,n,i,s,name,p,used,free,totalVram,driver,seen) {
    n=split(ENVIRON["gpu"],rows,"\n")
    for (i=1;i<=n+1;i++) {
        s=rows[i]
        if (i>n || s ~ /<class /) {
            if (driver!="" && !(driver in seen)) {
                seen[driver]=1
                totalVram=(used!="null" && free!="null") ? sprintf("%.0f",used+free) : "null"
                gpus=add(gpus,"{\"name\":" quote(name) ",\"percent\":" p ",\"vram\":" pair(used,totalVram,1) "}")
            }
            driver=s
            if (match(s,/id 0x[[:xdigit:]]+/)) driver=substr(s,RSTART,RLENGTH)
            name=s; sub(/^.*<class /,"",name); sub(/,.*/,"",name)
            p=used=free="null"
        } else if (s ~ /"model" = "/) {
            sub(/^.*"model" = "/,"",s); sub(/".*/,"",s); name=s
        } else if (s ~ /"PerformanceStatistics" =/) {
            p=counter(s,"Device Utilization %")
            used=counter(s,"vramUsedBytes")
            free=counter(s,"vramFreeBytes")
        }
    }
}
function mac(    a,n,i,s,freePages,havePages,pageSize,ram,boot,t,u) {
    cores=num(ENVIRON["cores"],1); ram=ENVIRON["ram"]; boot=ENVIRON["boot"]
    if (match(boot,/sec = [0-9]+/)) uptime=ENVIRON["now"]-substr(boot,RSTART+6,RLENGTH-6)
    split(ENVIRON["load"],a); if (a[1]=="{") loads=num(a[2],1) "," num(a[3],1) "," num(a[4],1)
    n=split(ENVIRON["cpu"],a)
    for (i=2;i<=n;i++) if (a[i] ~ /^idle/) {s=a[i-1]; sub(/%$/,"",s); if (num(s,1)!="null") percent=100-s; break}
    n=split(ENVIRON["vm"],a,"\n")
    for (i=1;i<=n;i++) {
        s=a[i]
        if (match(s,/page size of [0-9]+/)) pageSize=substr(s,RSTART+13,RLENGTH-13)
        if (s ~ /^Pages (free|inactive|speculative):/) {sub(/^.*:[[:space:]]*/,"",s); freePages+=int(s); havePages=1}
    }
    if (pageSize>0 && havePages) memory=pair(sprintf("%.0f",ram-freePages*pageSize),ram,1)
    n=split(ENVIRON["swap"],a)
    for (i=1;i<=n;i++) {
        if (a[i]=="total") t=swapBytes(a[i+2])
        if (a[i]=="used") u=swapBytes(a[i+2])
    }
    if (u!="" && t!="") swap=pair(u,t,1)
    macGpu()
}
BEGIN {
    for (i=1;i<32;i++) control[sprintf("%c",i)]=sprintf("\\u%04x",i)
    percent=uptime=packageTemp=cores="null"; memory=swap="null"
    if (ENVIRON["os"]=="Linux") {cores=0; linux()} else mac()
    driveRows()
    printf "{\"os\":%s,\"hostname\":%s,\"uptime\":%s,",quote(ENVIRON["os"]),quote(ENVIRON["host"]),uptime
    printf "\"cpu\":{\"cores\":%s,\"percent\":%s,\"load\":[%s]",cores,percent,loads
    if (total>0) printf ",\"totalTicks\":%.0f,\"idleTicks\":%.0f",total,idle
    printf "},\"packageTemp\":%s,\"sensors\":[%s],\"memory\":%s,\"swap\":%s,\"gpus\":[%s],\"drives\":[%s]}\n",packageTemp,temps,memory,swap,gpus,disks
    exit
}' "$@"
