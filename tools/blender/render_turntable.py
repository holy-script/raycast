"""Build low-poly proxy characters and render directional sprite frames.

Run headless:
  blender -b --factory-startup --python tools/blender/render_turntable.py -- \
      --character scout --resolution 384 --samples 24

Characters: guardian, scout, brute. Output defaults to
assets-src/characters/{character}/raw.

Frame naming: {state}_f{frame}_p{pitch}_y{yaw}.png
  pitch 0 = camera below, 1 = level, 2 = above, 3 = near-overhead
  yaw 0 = camera in front of the character, increasing counter-clockwise
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


BASE_PALETTE = {
    "jacket": (0.55, 0.13, 0.045, 1.0),
    "pants": (0.035, 0.16, 0.17, 1.0),
    "skin": (0.72, 0.55, 0.32, 1.0),
    "joint": (0.012, 0.015, 0.024, 1.0),
    "pad": (0.06, 0.09, 0.15, 1.0),
    "visor": (0.04, 0.62, 0.72, 1.0),
    "belt": (0.62, 0.34, 0.08, 1.0),
    "pack": (0.05, 0.07, 0.11, 1.0),
}

CHARACTERS = {
    "guardian": {
        "palette": {},
        "bulk": 1.0,
        "leg": 1.0,
        "helmet": 1.0,
        "visor_emission": 2.4,
        "tanks": True,
        "antenna": 0.13,
        "shoulder_plate": False,
        "pack_scale": (0.2, 0.1, 0.19),
    },
    "scout": {
        "palette": {
            "jacket": (0.09, 0.42, 0.4, 1.0),
            "pants": (0.05, 0.09, 0.14, 1.0),
            "skin": (0.78, 0.62, 0.4, 1.0),
            "pad": (0.05, 0.12, 0.14, 1.0),
            "visor": (0.25, 0.95, 0.78, 1.0),
            "belt": (0.32, 0.5, 0.28, 1.0),
            "pack": (0.04, 0.08, 0.09, 1.0),
        },
        "bulk": 0.84,
        "leg": 1.0,
        "helmet": 0.86,
        "visor_emission": 3.4,
        "tanks": False,
        "antenna": 0.2,
        "shoulder_plate": False,
        "pack_scale": (0.17, 0.09, 0.15),
    },
    "brute": {
        "palette": {
            "jacket": (0.3, 0.09, 0.06, 1.0),
            "pants": (0.09, 0.1, 0.12, 1.0),
            "skin": (0.55, 0.42, 0.3, 1.0),
            "pad": (0.13, 0.13, 0.15, 1.0),
            "visor": (1.0, 0.33, 0.08, 1.0),
            "belt": (0.42, 0.22, 0.06, 1.0),
            "pack": (0.06, 0.06, 0.08, 1.0),
        },
        "bulk": 1.3,
        "leg": 1.0,
        "helmet": 1.18,
        "visor_emission": 2.8,
        "tanks": True,
        "antenna": 0.0,
        "shoulder_plate": True,
        "pack_scale": (0.25, 0.12, 0.2),
    },
}

PITCH_ANGLES = [-0.31, 0.0, 0.49, 1.25]
PITCH_NAMES = ["low", "level", "high", "top"]
# The near-overhead view projects the character's height into a small footprint,
# so tighten the ortho frame there to keep the silhouette readable in-game.
PITCH_SCALES = [1.15, 1.15, 1.15, 0.78]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--character", default="guardian", choices=sorted(CHARACTERS))
    parser.add_argument("--out", default="")
    parser.add_argument("--resolution", type=int, default=384)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--yaws", type=int, default=16)
    parser.add_argument("--only", default="", help="state:frame:pitch:yaw for a single test render")
    parser.add_argument("--pitches", default="", help="comma-separated pitch indices to render")
    parser.add_argument(
        "--no-controls",
        dest="controls",
        action="store_false",
        help="skip the depth/normal control renders",
    )
    parser.add_argument(
        "--control-samples",
        type=int,
        default=4,
        help="Cycles samples for control passes (they need no color detail)",
    )
    args = parser.parse_args(argv)
    if not args.out:
        args.out = os.path.join("assets-src", "characters", args.character, "raw")
    args.control = os.path.join(os.path.dirname(args.out), "control")
    return args


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
    bsdf.inputs["Roughness"].default_value = 0.55
    if emission > 0:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = color
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    return material


def add_box(name, location, scale, material, parent=None, bevel=0.008):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.location = location
    if parent is not None:
        obj.parent = parent
    obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def add_cylinder(name, location, radius, depth, material, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=depth)
    obj = bpy.context.object
    obj.name = name
    obj.location = location
    if parent is not None:
        obj.parent = parent
    obj.data.materials.append(material)
    return obj


def add_empty(name, location, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_size = 0.05
    obj.location = location
    if parent is not None:
        obj.parent = parent
    return obj


def build_character(character):
    cfg = CHARACTERS[character]
    palette = {**BASE_PALETTE, **cfg["palette"]}
    mats = {key: make_material(f"mat_{key}", color) for key, color in palette.items()}
    mats["visor"] = make_material(
        "mat_visor", palette["visor"], emission=cfg["visor_emission"]
    )

    bulk = cfg["bulk"]
    leg = cfg["leg"]
    helmet = cfg["helmet"]

    root = add_empty("root", (0, 0, 0))
    torso = add_empty("torso", (0, 0, 0.45), parent=root)

    # Torso, belt and backpack.
    add_box(
        "chest",
        (0, 0, 0.12),
        (0.26 * bulk, 0.17, 0.25),
        mats["jacket"],
        parent=torso,
    )
    add_box(
        "belt",
        (0, 0, 0.015),
        (0.27 * bulk, 0.18, 0.035),
        mats["belt"],
        parent=torso,
        bevel=0.004,
    )
    pack_scale = cfg["pack_scale"]
    add_box(
        "pack",
        (0, 0.13, 0.13),
        pack_scale,
        mats["pack"],
        parent=torso,
    )
    if cfg["tanks"]:
        tank_x = 0.06 * bulk
        add_cylinder(
            "tank_l", (-tank_x, 0.18, 0.13), 0.022, 0.16, mats["pad"], parent=torso
        )
        add_cylinder(
            "tank_r", (tank_x, 0.18, 0.13), 0.022, 0.16, mats["pad"], parent=torso
        )
    add_box(
        "collar",
        (0, 0, 0.255),
        (0.16 * bulk, 0.13, 0.03),
        mats["pad"],
        parent=torso,
        bevel=0.004,
    )

    # Head, visor and antenna.
    head_pivot = add_empty("head_pivot", (0, 0, 0.3), parent=torso)
    add_box(
        "helmet",
        (0, 0.008, 0.06),
        (0.175 * helmet, 0.17, 0.17),
        mats["pad"],
        parent=head_pivot,
    )
    add_box(
        "face",
        (0, -0.084, 0.055),
        (0.125 * helmet, 0.035, 0.11),
        mats["skin"],
        parent=head_pivot,
        bevel=0.004,
    )
    add_box(
        "visor",
        (0, -0.102, 0.07),
        (0.1 * helmet, 0.012, 0.03),
        mats["visor"],
        parent=head_pivot,
        bevel=0.002,
    )
    if cfg["antenna"] > 0:
        add_cylinder(
            "antenna",
            (0.065 * helmet, 0.02, 0.15),
            0.004,
            cfg["antenna"],
            mats["joint"],
            parent=head_pivot,
        )
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.013)
        tip = bpy.context.object
        tip.name = "antenna_tip"
        tip.location = (0.065 * helmet, 0.02, 0.15 + cfg["antenna"] * 0.55)
        tip.parent = head_pivot
        tip.data.materials.append(mats["belt"])

    # Arms pivot at the shoulders so a single bone-like rotation reads clearly.
    arms = {}
    for side, sign in (("l", 1), ("r", -1)):
        shoulder = add_empty(
            f"shoulder_{side}", (0.19 * bulk * sign, 0, 0.19), parent=torso
        )
        add_box(
            f"pad_{side}",
            (0, 0, 0.01),
            (0.12 * bulk, 0.135, 0.09),
            mats["pad"],
            parent=shoulder,
        )
        add_box(
            f"arm_{side}",
            (0, 0, -0.17),
            (0.075 * bulk, 0.085, 0.31),
            mats["jacket"],
            parent=shoulder,
        )
        add_box(
            f"hand_{side}",
            (0, 0, -0.345),
            (0.082 * bulk, 0.09, 0.08),
            mats["joint"],
            parent=shoulder,
        )
        if cfg["shoulder_plate"]:
            add_box(
                f"plate_{side}",
                (0.03 * sign, -0.01, 0.035),
                (0.09, 0.15, 0.035),
                mats["belt"],
                parent=shoulder,
                bevel=0.004,
            )
        arms[side] = shoulder

    # Legs pivot at the hips; feet point forward along -Y.
    legs = {}
    for side, sign in (("l", 1), ("r", -1)):
        hip = add_empty(f"hip_{side}", (0.075 * bulk * sign, 0, 0.45), parent=root)
        add_box(
            f"leg_{side}",
            (0, 0, -0.19 * leg),
            (0.1 * bulk, 0.11, 0.38 * leg),
            mats["pants"],
            parent=hip,
        )
        add_box(
            f"foot_{side}",
            (0, -0.045, -0.41 * leg),
            (0.12 * bulk, 0.21, 0.07),
            mats["pants"],
            parent=hip,
        )
        legs[side] = hip

    return {
        "root": root,
        "torso": torso,
        "head": head_pivot,
        "shoulder_l": arms["l"],
        "shoulder_r": arms["r"],
        "hip_l": legs["l"],
        "hip_r": legs["r"],
    }


def idle_pose(rig, frame):
    breath = 0.006 if frame % 2 == 0 else -0.004
    rig["torso"].location.z = 0.45 + breath
    rig["head"].rotation_euler = (0.02 if frame % 2 == 0 else -0.015, 0, 0)
    rig["shoulder_l"].rotation_euler = (0.04, 0, -0.06)
    rig["shoulder_r"].rotation_euler = (-0.03, 0, 0.06)
    rig["hip_l"].rotation_euler = (0.02, 0, 0)
    rig["hip_r"].rotation_euler = (-0.02, 0, 0)


WALK_POSES = [
    (0.44, -0.44, -0.34, 0.34, 0.0),
    (0.1, -0.1, 0.0, 0.0, 0.012),
    (-0.44, 0.44, 0.34, -0.34, 0.0),
    (-0.1, 0.1, 0.0, 0.0, 0.012),
]


def walk_pose(rig, frame):
    hip_l, hip_r, arm_l, arm_r, lift = WALK_POSES[frame % len(WALK_POSES)]
    rig["hip_l"].rotation_euler = (hip_l, 0, 0)
    rig["hip_r"].rotation_euler = (hip_r, 0, 0)
    rig["shoulder_l"].rotation_euler = (arm_l, 0, -0.05)
    rig["shoulder_r"].rotation_euler = (arm_r, 0, 0.05)
    rig["torso"].location.z = 0.45 + lift
    rig["head"].rotation_euler = (0.01, 0, 0)


def setup_render(args):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.08
    scene.cycles.use_denoising = False
    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 60
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    # ControlNet passes. They are rendered separately from the RGBA frame, so the
    # raw output stays byte-compatible with earlier atlas runs.
    view_layer = bpy.context.view_layer
    view_layer.use_pass_z = True
    view_layer.use_pass_normal = True
    scene.render.use_compositing = False

    world = bpy.data.worlds.new("proxy_world")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.05, 0.06, 0.08, 1.0)
    background.inputs["Strength"].default_value = 0.5
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

    add_sun("key", (-2.0, -2.4, 3.0), 3.6, (1.0, 0.93, 0.82), 0.18)
    add_sun("fill", (2.6, -1.4, 1.6), 1.4, (0.72, 0.85, 1.0), 0.4)
    add_sun("rim", (0.5, 3.0, 2.4), 2.4, (0.62, 0.9, 1.0), 0.3)

    camera_data = bpy.data.cameras.new("turntable_camera")
    camera_data.type = "ORTHO"
    # Slightly wider than the 1.0 world cell so raised/lowered pitch views never clip.
    camera_data.ortho_scale = 1.15
    camera = bpy.data.objects.new("turntable_camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    return camera


def aim_camera(camera, yaw_index, pitch_angle, yaws, radius=4.0, target_z=0.5):
    azimuth = (yaw_index / yaws) * math.tau
    horizontal = math.cos(pitch_angle) * radius
    camera.location = (
        math.sin(azimuth) * horizontal,
        -math.cos(azimuth) * horizontal,
        target_z + math.sin(pitch_angle) * radius,
    )
    direction = Vector((0, 0, target_z)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _control_group(scene):
    """Creates a fresh compositor group feeding one image to the render output."""
    scene.compositing_node_group = None
    previous = bpy.data.node_groups.get("RaycastControls")
    if previous:
        bpy.data.node_groups.remove(previous)
    group = bpy.data.node_groups.new("RaycastControls", "CompositorNodeTree")
    group.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    render_layers = group.nodes.new("CompositorNodeRLayers")
    output = group.nodes.new("NodeGroupOutput")
    scene.compositing_node_group = group
    scene.render.use_compositing = True
    return group, render_layers, output


def _map_range(group, from_min, from_max, to_min, to_max):
    node = group.nodes.new("ShaderNodeMapRange")
    node.clamp = True
    node.inputs["From Min"].default_value = from_min
    node.inputs["From Max"].default_value = from_max
    node.inputs["To Min"].default_value = to_min
    node.inputs["To Max"].default_value = to_max
    return node


def configure_depth(scene):
    """Near surfaces are white, far surfaces are black, background is black."""
    group, render_layers, output = _control_group(scene)
    depth = _map_range(group, 3.2, 5.0, 1.0, 0.0)
    group.links.new(render_layers.outputs["Depth"], depth.inputs["Value"])
    group.links.new(depth.outputs["Result"], output.inputs[0])


def configure_normal(scene):
    """Encodes the camera-space normal as RGB in [0, 1] and masks the background."""
    group, render_layers, output = _control_group(scene)
    separate = group.nodes.new("ShaderNodeSeparateXYZ")
    combine = group.nodes.new("ShaderNodeCombineXYZ")
    group.links.new(render_layers.outputs["Normal"], separate.inputs["Vector"])
    for axis in ("X", "Y", "Z"):
        channel = _map_range(group, -1.0, 1.0, 0.0, 1.0)
        group.links.new(separate.outputs[axis], channel.inputs["Value"])
        group.links.new(channel.outputs["Result"], combine.inputs[axis])

    black = group.nodes.new("CompositorNodeRGB")
    black.outputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    over = group.nodes.new("CompositorNodeAlphaOver")
    group.links.new(black.outputs["Color"], over.inputs["Background"])
    group.links.new(combine.outputs["Vector"], over.inputs["Foreground"])
    group.links.new(render_layers.outputs["Alpha"], over.inputs["Factor"])
    group.links.new(over.outputs["Image"], output.inputs[0])


def render_control(scene, camera, args, mode, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if mode == "depth":
        configure_depth(scene)
    else:
        configure_normal(scene)
    scene.cycles.samples = args.control_samples
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "BW" if mode == "depth" else "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = path
    scene.view_settings.view_transform = "Raw"
    bpy.context.view_layer.update()
    bpy.ops.render.render(write_still=True)


def restore_rgba_render(scene, args):
    scene.render.use_compositing = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 60
    scene.cycles.samples = args.samples
    scene.view_settings.view_transform = "Standard"


def main():
    args = parse_args()
    reset_scene()
    rig = build_character(args.character)
    camera = setup_render(args)
    os.makedirs(args.out, exist_ok=True)

    states = [
        ("idle", 2, idle_pose),
        ("walk", 4, walk_pose),
    ]

    only = None
    if args.only:
        parts = args.only.split(":")
        only = (parts[0], int(parts[1]), int(parts[2]), int(parts[3]))

    pitch_angles = PITCH_ANGLES
    selected_pitches = (
        [int(index) for index in args.pitches.split(",") if index != ""]
        if args.pitches
        else list(range(len(pitch_angles)))
    )
    rendered = 0
    for state_name, frame_count, pose_fn in states:
        for frame in range(frame_count):
            pose_fn(rig, frame)
            bpy.context.view_layer.update()
            for pitch in selected_pitches:
                camera.data.ortho_scale = PITCH_SCALES[pitch]
                for yaw in range(args.yaws):
                    if only and only != (state_name, frame, pitch, yaw):
                        continue
                    aim_camera(camera, yaw, pitch_angles[pitch], args.yaws)
                    bpy.context.view_layer.update()
                    filename = f"{state_name}_f{frame}_p{pitch}_y{yaw}.png"
                    restore_rgba_render(bpy.context.scene, args)
                    bpy.context.scene.render.filepath = os.path.join(args.out, filename)
                    bpy.ops.render.render(write_still=True)
                    rendered += 1
                    if args.controls:
                        render_control(
                            bpy.context.scene,
                            camera,
                            args,
                            "depth",
                            os.path.join(args.control, "depth", filename),
                        )
                        render_control(
                            bpy.context.scene,
                            camera,
                            args,
                            "normal",
                            os.path.join(args.control, "normal", filename),
                        )
                    print(f"rendered {filename}", flush=True)

    print(f"done: {rendered} frames -> {args.out}", flush=True)


main()
