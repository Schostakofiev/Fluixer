# Fluixer 0.3.2

A design tool to simulate and export csv of Fluixel, an information visualisation method based on liquid segments.
https://fluixer-production.up.railway.app/
## Interactive pipeline curve

Choose **Pipe → Pipeline Curve → Interactive** to start from an open 80 mm line.
While the Pipe tab is active, left-drag the curve in the 3D view. The drag follows
 the current view plane; rotate the view with the existing right-mouse controls
 to edit another spatial direction. **Grab Radius (mm)** sets the pointer picking radius
 (bounded on screen for usability).

The curve updates during dragging; liquid/gas calculation and metrics update on
 release, after the rope settles. Escape cancels the current drag. Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y undo
 and redo edits. Pipe Reset restores the initial line. Curve geometry is included
 in project saves and uses the existing animation, rendering, mapping and CSV flow.

**Total Length (mm)** adds material at the tail endpoint or trims that tail.
The existing points remain in place when extending; the shape is not globally
scaled. Length stays constrained during dragging and collisions are always on.

Use the pin icon on the left of the viewport to enter pin mode. Click the curve to pin
its nearest material node; clicks within 14 screen pixels of an endpoint snap
there. Click a pin to select its XYZ move axes; Alt-click a pin to remove it. Turn the tool off to resume dragging.
Pins are saved with the project and included in undo/redo. Extension can continue
past a pinned endpoint, leaving that pin at its original position. Trimming
stops at the last pin. A taut section between two pins cannot bend until a pin
is removed. Pipe Reset clears the pins and restores the original 80 mm line.

The length control normally covers 10–1000 mm. The minimum increases to protect
pinned points. There are at most 129 editable particles; a fully subdivided
curve with a pinned tail must release that tail pin before further extension.
An extension that intersects the pipe is rejected; move the endpoint first.
There is no gravity or minimum bend-radius constraint.

The browser implements a damped particle/constraint solver, using the structure
 of `cableCollide.ghx` as a reference: Divide/Shatter -> Line -> Length(Line) +
 Collider + Grab -> Solver. The sample uses 10 divisions, collider radius 0.2,
 length strength 10, collider/grab strength 1 and grab range 3. Fluixer uses the
 current pipe outer radius and its own numerical weights; it does not run the
 Kangaroo engine. Per-span spline-length goals propagate pulling through the
 rope, capsule contacts separate overlapping sections, and a grab goal follows
 the pointer. The solver advances on animation frames, including while the
 pointer is stationary, and briefly settles after release. Collision tolerances
 are numerical and do not certify manufacturing clearance.

### Tension and stiffness

Tighten and Loosen work with or without pins. With no pins, the whole curve changes length; with pins, the clicked interval is bounded by neighboring pins or free endpoints.
Hold between adjacent pins to progressively tighten the selected section;
longer presses remove more slack. Pins and control points outside the selected interval stay in place. Free endpoints can move.
Stiffness (0–100, default 20) controls resistance to bending and relaxes the
curve as it changes. Length and collision constraints remain active.
These edits support undo/redo and project saves; Escape cancels an active solve.

The Loosen tool beside Tighten adds 5% of the initial selected span length per second held,
up to the 1000 mm total limit. It keeps pins and other control points fixed,
with collision constraints active. Straight spans bow out as slack is added.

Drag a selected pin's XYZ arrow to reposition that anchor along one axis.
Other pins stay fixed; length and collision constraints limit the reachable position.
Escape cancels a move, and undo/redo restores the curve and anchor position together.

Tighten and Loosen use elapsed press time, not frame count. Release stops changing
the requested length and lets the constraints settle; Escape cancels the whole press.
Each press is one undo step. Tighten removes 20% of remaining slack per second.

While the released curve is settling, right-drag can rotate/pan the view and
the wheel can zoom. Geometry and endpoint markers follow the current camera.

Brush offers 2D and 3D modes. 2D opens the projection plane for direct drawing
with its transformed coordinates; deselect the brush or choose the plane gizmo
to manipulate the plane. 3D paints on the visible pipe and disables plane tools.
Both modes retain their own marks while switching and use the viewport tool icons.

## 3D Print preview

The third display icon shows a CAD enclosure with the inner-diameter channel subtracted.
The enclosure orientation is searched by volume using CAD, principal-axis and world-axis candidates, then locally refined; this is a numerical tight-box search, not a proof of the global minimum. Outer diameter supplies the envelope thickness. The translucent solid exposes the buried channel.
The preview is cached and recalculated after pipe geometry or inner diameter changes. It does not change simulation or CSV output. S-Shape and Hilbert channels extend along their endpoint tangents through the enclosure. The Export STEP icon appears in print mode and exports the same CAD solid in millimeters. Liquid segments remain a colored preview overlay and are not exported.
