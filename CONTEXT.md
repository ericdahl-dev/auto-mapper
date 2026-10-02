# auto-mapper

A projection mapper: a projector and a webcam scan a space, the surfaces in it are found, and live effects are played back onto them through the projector.

## Language

### Shows and projects

**Space**:
The physical place the projector and camera point at, such as a room, a porch or a wall.
_Avoid_: Scene, site, set, venue, room (for the general idea)

**Show**:
Everything one projection mapping consists of: its surfaces, its scenes, its playlist, and whether it is playing.
_Avoid_: Scene (for the whole), mapping, setup

**Current show**:
The show being edited or played right now. It always belongs to the latest scan, and is unsaved until it's saved as a project.
_Avoid_: Working copy, latest scan (for the show)

**Project**:
A named, saved show together with the scan it was mapped on. Opening a project makes it the current show; saving copies the current show into a project.
_Avoid_: File, save, workspace

**Scan**:
One run of projected stripe patterns, captured by the camera, that records which camera pixel sees which projector pixel. It produces the scan image.
_Avoid_: Capture, calibration, mapping

**Scan image**:
A picture of the space as the projector sees it, made by a scan; surfaces are found in it and scan-reactive effects read it.
_Avoid_: Scene (for the picture), photo, camera image

**Calibration**:
Setting the camera's exposure and gain so the projected white is bright but not clipped, before a scan.
_Avoid_: Calibration for alignment (say realignment) or for sound timing (say sync measurement)

**Coverage**:
The share of the projection a scan could decode.

**Missed areas**:
The parts of the projection a scan couldn't decode: shadows, surfaces too dark, or places the camera can't see.
_Avoid_: Holes, gaps, dead zones

### Surfaces

**Surface**:
A physical area of the space (a wall, a cabinet door, a corbel) that gets its own effect.
_Avoid_: Zone, section, region, mask, polygon, shape

**Outline**:
The edge of a surface, as the projector sees it; straight sides and curves.
_Avoid_: Polygon, path, border, mask

**Detected surface**:
A surface found by surface detection and not changed by hand. Redetecting replaces it.

**Edited surface**:
A detected surface whose outline was then changed by hand. Redetecting keeps it.

**Drawn surface**:
A surface made by hand. Redetecting keeps it.
_Avoid_: Manual surface

**Edge**:
How far a surface's lit area is shrunk inside its outline (to stop light spilling past the object) or grown past it (to cover a gap). The outline itself stays where it is.
_Avoid_: Feather, bleed, inset

### Effects

**Effect**:
A kind of live visual a surface can show, such as Fill, Outline trace, Noise flow, Text or Image / video.
_Avoid_: Shader, animation, asset, content

**Settings**:
The adjustable values of an effect on one surface, such as its color, speed or zoom.
_Avoid_: Params, parameters, properties, controls

**Scan-reactive effect**:
An effect that reads the scan image, so it responds to what is really on the surface (Tint, Edge glow, Posterize).

**Sound-reactive effect**:
An effect whose React to sound setting is turned up, so it follows the sound from the microphone or the playing videos.

### Scenes

**Scene**:
One look of a show: which effect, with which settings, each surface shows. A show can have several scenes over the same surfaces.
_Avoid_: Slide, cue, look, preset

**Playlist**:
The order a show's scenes play in: each with a duration, or held until the next one is triggered, with a crossfade between them; it may loop.
_Avoid_: Cue list, sequence, slideshow

### Playing

**Edit mode**:
How the show is projected while it's being worked on: effects plus the selection highlight and error outlines.

**Play mode**:
How the show is projected for an audience: effects only.
_Avoid_: Presentation, live, performance mode

**Blackout**:
The projector shows nothing, in either mode, until blackout is turned off.

**Realign**:
Moving the whole show back into place after the projector got bumped, by dragging its four corners, without a new scan. A new scan replaces it.
_Avoid_: Keystone, recalibrate

**Brightness**:
How bright the whole show is projected, from dark to full. One setting for the show, not per surface.
_Avoid_: Master dimmer, opacity

**Undo step**:
One change to the show that Undo takes back as a whole: a drag, a burst of typing, a merge. Choosing surfaces, Play mode, Blackout and sound aren't undo steps. A new scan or opening a project starts over.

### Hardware and windows

**Projector**:
The physical projector, connected to the Mac as an extended display, that lights the surfaces.
_Avoid_: Display, screen, output (for the device)

**Output window**:
The fullscreen browser page on the projector that draws the scan patterns, test frames and effects.
_Avoid_: Stage, projector page

**Editor**:
The browser page on the Mac's own screen where scans, surfaces, effects and projects are managed.
