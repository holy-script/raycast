"""Render first-person viewmodel frames (gauntlets + plasma projector).

Run headless:
  blender -b --factory-startup --python tools/blender/render_viewmodel.py -- \
      --resolution 160 --samples 24

The camera sits at the player's eye and looks down the +Y axis, so geometry is
authored in camera space: +X is right, +Y is forward, +Z is up. Frames are
transparent RGBA and copied into public/assets/sprites/player by the caller.
"""

import argparse
import os
import sys

import bpy
from mathutils import Vector


PALETTE = {
    "armor": (0.20, 0.23, 0.30, 1.0),
    "armor_dark": (0.075, 0.085, 0.115, 1.0),
    "plate": (0.55, 0.18, 0.06, 1.0),
    "trim": (0.72, 0.45, 0.12, 1.0),
    "joint": (0.02, 0.022, 0.032, 1.0),
    "energy": (0.10, 0.80, 0.95, 1.0),
    "lens": (1.0, 0.42, 0.12, 1.0),
}

# Pose deltas are applied to the shoulder pivot so the whole arm swings.
# (name, location, rotation, muzzle flash)
POSES = [
    ("idle0", (0.000, 0.000, 0.000), (0.000, 0.000, 0.000), False),
    ("idle1", (0.004, 0.002, -0.004), (0.010, 0.005, 0.006), False),
    ("windup", (0.018, -0.040, -0.026), (0.32, 0.06, -0.18), False),
    ("strike", (-0.055, 0.070, 0.020), (-0.15, -0.07, 0.10), True),
    ("recover", (-0.012, 0.020, 0.004), (-0.05, -0.02, 0.03), False),
]

PIVOT = Vector((0.43, 0.28, -0.64))


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join("assets-src", "viewmodel", "raw"))
    parser.add_argument("--resolution", type=int, default=256)
    parser.add_argument("--height", type=int, default=208)
    parser.add_argument("--samples", type=int, default=24)
    return parser.parse_args(argv)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        if block.users == 0:
            bpy.data.materials.remove(block)


def make_material(name, color, emission=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.48
    bsdf.inputs["Metallic"].default_value = 0.3
    if emission > 0:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = color
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    return material


def add_box(name, center, size, material, parent):
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    obj.location = Vector(center) - PIVOT
    obj.parent = parent
    obj.data.materials.append(material)
    bevel = obj.modifiers.new("bevel", "BEVEL")
    bevel.width = 0.006
    bevel.segments = 2
    return obj


def add_segment(name, start, end, width, depth, material, parent):
    """Box spanning two points, local +Y aligned with the segment."""
    a = Vector(start)
    b = Vector(end)
    direction = b - a
    length = direction.length
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (width, length, depth)
    obj.location = (a + b) / 2 - PIVOT
    obj.rotation_euler = direction.to_track_quat("Y", "Z").to_euler()
    obj.parent = parent
    obj.data.materials.append(material)
    bevel = obj.modifiers.new("bevel", "BEVEL")
    bevel.width = 0.008
    bevel.segments = 2
    return obj


def add_cylinder_between(name, start, end, radius, material, parent, vertices=10):
    a = Vector(start)
    b = Vector(end)
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length)
    obj = bpy.context.object
    obj.name = name
    obj.location = (a + b) / 2 - PIVOT
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.parent = parent
    obj.data.materials.append(material)
    return obj


def add_sphere(name, center, radius, material, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=radius)
    obj = bpy.context.object
    obj.name = name
    obj.location = Vector(center) - PIVOT
    obj.parent = parent
    obj.data.materials.append(material)
    return obj


def build_viewmodel():
    mats = {key: make_material(f"vm_{key}", color) for key, color in PALETTE.items()}
    mats["energy"] = make_material("vm_energy", PALETTE["energy"], emission=6.0)
    mats["lens"] = make_material("vm_lens", PALETTE["lens"], emission=3.0)

    root = bpy.data.objects.new("arm_root", None)
    bpy.context.collection.objects.link(root)
    root.empty_display_size = 0.05
    root.location = PIVOT

    # Right arm: shoulder -> elbow -> wrist, ending in a gauntlet grip.
    shoulder = (0.46, 0.24, -0.66)
    elbow = (0.37, 0.58, -0.38)
    wrist = (0.215, 0.90, -0.155)
    add_sphere("shoulder_pad_r", shoulder, 0.125, mats["plate"], root)
    add_segment("upper_r", shoulder, elbow, 0.125, 0.125, mats["armor"], root)
    add_sphere("elbow_r", elbow, 0.095, mats["joint"], root)
    add_segment("forearm_r", elbow, wrist, 0.125, 0.115, mats["plate"], root)
    add_box("wrist_r", wrist, (0.12, 0.115, 0.10), mats["armor_dark"], root)
    add_box("hand_r", (0.175, 0.985, -0.115), (0.095, 0.13, 0.09), mats["joint"], root)
    add_box("grip_r", (0.168, 1.00, -0.045), (0.05, 0.085, 0.10), mats["armor_dark"], root)
    add_box("knuckle_r", (0.205, 1.045, -0.075), (0.05, 0.07, 0.075), mats["trim"], root)

    # Left support arm enters from the lower left and grips the foregrip.
    shoulder_l = (-0.42, 0.24, -0.70)
    elbow_l = (-0.22, 0.57, -0.45)
    wrist_l = (-0.015, 0.89, -0.245)
    add_segment("upper_l", shoulder_l, elbow_l, 0.115, 0.115, mats["armor"], root)
    add_sphere("elbow_l", elbow_l, 0.088, mats["joint"], root)
    add_segment("forearm_l", elbow_l, wrist_l, 0.108, 0.10, mats["plate"], root)
    add_box("hand_l", (0.025, 1.00, -0.185), (0.09, 0.12, 0.09), mats["joint"], root)
    add_box("knuckle_l", (0.055, 1.06, -0.15), (0.055, 0.065, 0.07), mats["trim"], root)

    # Plasma projector: receiver, angled barrel, lens, vents and underbarrel grip.
    add_box("receiver", (0.135, 1.070, -0.040), (0.205, 0.38, 0.175), mats["armor"], root)
    add_box("receiver_top", (0.128, 1.075, 0.050), (0.125, 0.30, 0.060), mats["armor_dark"], root)
    add_box("accent", (0.135, 1.045, -0.135), (0.185, 0.26, 0.032), mats["trim"], root)
    add_box("stock", (0.160, 0.890, -0.035), (0.150, 0.12, 0.135), mats["armor_dark"], root)
    add_cylinder_between(
        "barrel", (0.125, 1.235, -0.015), (-0.020, 1.425, 0.050),
        0.055, mats["armor_dark"], root,
    )
    add_cylinder_between(
        "muzzle", (-0.008, 1.402, 0.045), (-0.032, 1.447, 0.054),
        0.074, mats["armor"], root,
    )
    add_sphere("muzzle_lens", (-0.034, 1.450, 0.055), 0.052, mats["lens"], root)
    add_box("cell", (0.043, 1.055, 0.032), (0.046, 0.22, 0.065), mats["energy"], root)
    add_box("vent_l", (0.026, 1.185, -0.090), (0.028, 0.12, 0.026), mats["energy"], root)
    add_box("vent_r", (0.234, 1.185, -0.090), (0.028, 0.12, 0.026), mats["energy"], root)
    add_box("sight", (0.126, 1.140, 0.100), (0.046, 0.075, 0.030), mats["trim"], root)

    flash = add_sphere("muzzle_flash", (-0.048, 1.472, 0.057), 0.095, mats["energy"], root)
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.082, radius2=0.0, depth=0.24)
    cone = bpy.context.object
    cone.name = "muzzle_cone"
    cone.location = Vector((-0.092, 1.545, 0.064)) - PIVOT
    cone.rotation_euler = (1.5708, 0, 0)
    cone.parent = root
    cone.data.materials.append(mats["energy"])
    flash_parts = [flash, cone]
    for part in flash_parts:
        part.hide_render = True

    return root, flash_parts


def setup_render(args):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.12
    scene.cycles.use_denoising = False
    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 60
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    world = bpy.data.worlds.new("viewmodel_world")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.06, 0.07, 0.09, 1.0)
    background.inputs["Strength"].default_value = 0.7
    scene.world = world

    def add_sun(name, position, energy, color, angle):
        light_data = bpy.data.lights.new(name, type="SUN")
        light_data.energy = energy
        light_data.color = color
        light_data.angle = angle
        light = bpy.data.objects.new(name, light_data)
        bpy.context.collection.objects.link(light)
        travel = -Vector(position).normalized()
        light.rotation_euler = travel.to_track_quat("-Z", "Y").to_euler()
        return light

    add_sun("key", (-0.6, -1.0, 1.4), 4.2, (1.0, 0.92, 0.80), 0.16)
    add_sun("fill", (1.2, 0.2, 0.3), 1.5, (0.65, 0.82, 1.0), 0.5)
    add_sun("rim", (0.1, 1.4, 1.1), 2.6, (0.55, 0.85, 1.0), 0.3)

    # A perspective camera keeps the forward-pointing weapon readable; ortho
    # flattened the barrel and receiver into one silhouette.
    camera_data = bpy.data.cameras.new("viewmodel_camera")
    camera_data.type = "PERSP"
    camera_data.lens = 35
    camera = bpy.data.objects.new("viewmodel_camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0, 0, 0.12)
    direction = Vector((0.01, 1, 0.10)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    return camera


def main():
    args = parse_args()
    reset_scene()
    root, flash_parts = build_viewmodel()
    setup_render(args)
    os.makedirs(args.out, exist_ok=True)

    for name, location, rotation, flash in POSES:
        root.location = PIVOT + Vector(location)
        root.rotation_euler = rotation
        for part in flash_parts:
            part.hide_render = not flash
        bpy.context.view_layer.update()
        bpy.context.scene.render.filepath = os.path.join(args.out, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"rendered {name}", flush=True)

    print(f"done: {len(POSES)} frames -> {args.out}", flush=True)


main()
