# Windows PowerShell 5.1. Optional providers may be missing or require elevation.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
$system = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
$busy = $cpu.PercentProcessorTime
# The formatted counter can be missing (a broken performance registry); the processors' own load then.
if ($null -eq $busy) { $busy = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average }
function Metric($value, $factor = 1) {
    $number = 0.0
    if ([double]::TryParse([string]$value, [Globalization.NumberStyles]::Float,
        [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) { return $number * $factor }
}

$sensors = @()
$package = $null
$zones = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature)
foreach ($zone in $zones) {
    $value = [math]::Round($zone.CurrentTemperature / 10 - 273.15, 1)
    if ($value -gt -40 -and $value -lt 150) {
        $sensors += @{name=$zone.InstanceName; celsius=$value}
    }
}
if (!$sensors.Count) {
    foreach ($zone in (Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation)) {
        $value = [math]::Round($zone.Temperature - 273.15, 1)
        if ($value -gt -40 -and $value -lt 150) {
            $sensors += @{name=$zone.Name; celsius=$value}
        }
    }
}
# ACPI zones are not necessarily on the processor.
foreach ($zone in $sensors) {
    if ($zone.name -match 'CPU|Package|Processor' -and ($null -eq $package -or $zone.celsius -gt $package)) {
        $package = $zone.celsius
    }
}

$gpus = @()
$reported = @{}
if (Get-Command nvidia-smi -CommandType Application) {
    $csv = & nvidia-smi --query-gpu=pci.device_id,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -eq 0) {
        foreach ($row in ($csv | ConvertFrom-Csv -Header pci,name,busy,used,total,temp,watts)) {
            if (!$row.name) { continue }
            $gpus += @{name=$row.name.Trim(); percent=(Metric $row.busy); temp=(Metric $row.temp); watts=(Metric $row.watts)
                vram=@{used=(Metric $row.used 1MB); total=(Metric $row.total 1MB)}}
            if ($row.pci -match '0x([0-9a-f]{4})10de') { $reported[$Matches[1]]++ }
        }
    }
}
$adapters = @(Get-CimInstance Win32_VideoController)
$remaining = @(foreach ($adapter in $adapters) {
    if ($adapter.PNPDeviceID -match 'VEN_10DE&DEV_([0-9a-f]{4})' -and $reported[$Matches[1]] -gt 0) {
        $reported[$Matches[1]]--
    } else { $adapter }
})
if ($remaining.Count) {
    # CIM exposes the GPU Engine / Utilization Percentage counter without localized counter paths.
    $engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)
    $gpuMemory = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory)
}
foreach ($adapter in $remaining) {
    $device = Get-ItemProperty -LiteralPath ("HKLM:\SYSTEM\CurrentControlSet\Enum\" + $adapter.PNPDeviceID)
    $key = $null
    if ($device.Driver) {
        $key = Get-ItemProperty -LiteralPath ("HKLM:\SYSTEM\CurrentControlSet\Control\Class\" + $device.Driver)
    }
    $luid = $null
    if ($null -ne $key.AdapterLuid) {
        $idBytes = $key.AdapterLuid
        if ($idBytes -isnot [byte[]]) { $idBytes = [BitConverter]::GetBytes([long]$idBytes) }
        if ($idBytes.Length -eq 8) {
            $luid = 'luid_0x{0:x8}_0x{1:x8}_' -f [BitConverter]::ToUInt32($idBytes,4), [BitConverter]::ToUInt32($idBytes,0)
        }
    }
    $usage = $null
    $used = $null
    $total = $key.'HardwareInformation.qwMemorySize'
    if ($null -eq $total -and $adapter.AdapterRAM -gt 0 -and $adapter.AdapterRAM -lt [uint32]::MaxValue) {
        $total = $adapter.AdapterRAM
    }
    # Sum processes sharing an engine, then report the busiest engine on this adapter.
    $byEngine = @{}
    foreach ($engine in $engines) {
        if (($luid -and $engine.Name -like "*$luid*") -or (!$luid -and $adapters.Count -eq 1)) {
            $instance = $engine.Name -replace '^pid_\d+_', ''
            $byEngine[$instance] += [double]$engine.UtilizationPercentage
        }
    }
    if ($byEngine.Count) { $usage = [math]::Min(100.0, ($byEngine.Values | Measure-Object -Maximum).Maximum) }
    foreach ($entry in $gpuMemory) {
        if (($luid -and $entry.Name -like "*$luid*") -or (!$luid -and $adapters.Count -eq 1)) {
            $used += [long]$entry.DedicatedUsage
        }
    }
    $gpus += @{name=$adapter.Name; percent=$usage; vram=@{used=$used; total=$total}}
}
$drives = @(foreach ($disk in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3 OR DriveType=2')) {
    if ($disk.Size -gt 0 -and $null -ne $disk.FreeSpace) {
        @{mount=$disk.DeviceID; total=$disk.Size; used=($disk.Size - $disk.FreeSpace)}
    }
})
$pagefile = $null
try {
    $pages = @(Get-CimInstance Win32_PageFileUsage -ErrorAction Stop)
    $pagefile = @{used=0L; total=0L}
    foreach ($page in $pages) {
        $pagefile.used += [long]$page.CurrentUsage * 1MB
        $pagefile.total += [long]$page.AllocatedBaseSize * 1MB
    }
} catch {}
@{
    os='Windows'; hostname=$os.CSName; uptime=[math]::Floor(((Get-Date) - $os.LastBootUpTime).TotalSeconds)
    cpu=@{cores=$system.NumberOfLogicalProcessors; percent=$busy}
    memory=@{total=([long]$os.TotalVisibleMemorySize * 1KB); used=([long]($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) * 1KB)}
    swap=$pagefile; packageTemp=$package; sensors=$sensors; gpus=$gpus; drives=$drives
} | ConvertTo-Json -Depth 5 -Compress
