# Installed in Blender's Python interpreter through the Blender MCP add-on.
# No scene edits, render settings changes, temporary images or .blend file writes.
import base64
import bpy
import gpu
import math
import struct
import time
import zlib
from collections import deque

history = deque(maxlen=32)
subscription = None
lease_end = 0


def observe(server):
    """Observe the add-on only while a panel renews the lease."""
    global subscription, lease_end
    lease_end = time.monotonic() + 12
    if subscription is server:
        return
    if server is None or "execute_command" in vars(server):
        return  # Don't displace another observer's instance method.
    original = server.execute_command

    def dispatch(command):
        params = command.get("params") if isinstance(command, dict) else None
        code = params.get("code", "") if isinstance(params, dict) else ""
        if isinstance(code, str) and code.startswith("# mainframe viewport\n"):
            return original(command)
        start = time.monotonic()
        ok = False
        try:
            result = original(command)
            body = result.get("result")
            ok = result.get("status") == "success" and not (isinstance(body, dict) and body.get("error"))
            return result
        finally:
            # No supplied code, arguments, output, paths or exception text.
            tool = command.get("type", "command") if isinstance(command, dict) else "command"
            history.append({"tool": str(tool)[:80], "ok": bool(ok),
                            "ms": round((time.monotonic() - start) * 1000), "at": time.time()})

    def expire():
        global subscription
        left = lease_end - time.monotonic()
        if left > 0 and subscription is server:
            return max(0.1, left)
        if vars(server).get("execute_command") is dispatch:
            del server.execute_command
        if subscription is server:
            subscription = None
        return None

    bpy.app.timers.register(expire, first_interval=12, persistent=True)
    server.execute_command = dispatch
    subscription = server


def viewport():
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                region = next((r for r in area.regions if r.type == "WINDOW"), None)
                if region and area.spaces.active.region_3d:
                    return win, area.spaces.active, region


def capture(win, space, region):
    scale = min(1, 800 / max(1, region.width, region.height))
    w, h = max(1, int(region.width * scale)), max(1, int(region.height * scale))
    offscreen = gpu.types.GPUOffScreen(w, h)
    try:
        view = space.region_3d
        offscreen.draw_view3d(win.scene, win.view_layer, space, region, view.view_matrix,
                              view.window_matrix, do_color_management=True)
        buf = offscreen.texture_color.read()
        buf.dimensions = w * h * 4
        raw = bytes(buf)
    finally:
        offscreen.free()

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    stride = w * 4
    scanlines = b"".join(b"\0" + raw[i:i + stride] for i in range((h-1)*stride, -1, -stride))
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(scanlines, 2)) + chunk(b"IEND", b""))
    return {"w": w, "h": h, "png": base64.b64encode(png).decode("ascii")}


def describe(o):
    rotation = o.matrix_basis.to_euler()
    result = {"name": o.name, "type": o.type, "collections": [c.name for c in o.users_collection][:6],
              "position": [round(v, 2) for v in o.location], "size": [round(v, 2) for v in o.dimensions],
              "rotation": [round(math.degrees(v), 1) for v in rotation], "scale": [round(v, 3) for v in o.scale],
              "materials": [s.material.name for s in o.material_slots if s.material][:12],
              "modifiers": [m.name for m in o.modifiers][:12]}
    if o.type == "MESH" and o.data:
        result.update(vertices=len(o.data.vertices), faces=len(o.data.polygons))
    return result


def poll(track):
    found = viewport()
    win = found[0] if found else bpy.context.window
    scene = win.scene if win else bpy.context.scene
    layer = win.view_layer if win else bpy.context.view_layer
    active = layer.objects.active
    rd = scene.render
    if track:
        observe(getattr(bpy.types, "blendermcp_server", None))
    by_name = sorted(scene.objects, key=lambda o: (o != active, o.name))
    out = {"name": scene.name, "file": bpy.path.basename(bpy.data.filepath) or "Untitled",
           "dirty": bpy.data.is_dirty, "version": bpy.app.version_string,
           "engine": rd.engine, "resolution": [rd.resolution_x, rd.resolution_y, rd.resolution_percentage],
           "frame": scene.frame_current, "range": [scene.frame_start, scene.frame_end],
           "camera": scene.camera.name if scene.camera else None, "active": active.name if active else None,
           "count": len(by_name), "objects": [describe(o) for o in by_name[:300]],
           "materialCount": len(bpy.data.materials), "collectionCount": len(bpy.data.collections),
           "tracking": track and subscription is not None, "activity": list(history) if track else []}
    if found:
        out["shading"] = found[1].shading.type
        try:
            out["frameImage"] = capture(*found)
        except Exception as e:
            out["viewportError"] = str(e)[:200]
    else:
        out["viewportError"] = "Open a 3D Viewport in Blender to see its picture."
    return out
