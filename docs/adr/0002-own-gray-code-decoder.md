# Our own Gray-code decoder instead of OpenCV's

Scans are decoded by our own code (engine/scan.py), not OpenCV's `structured_light.GrayCodePattern`, which the original plan named. The rig is a dim projector (about 300 to 500 lumens) and a consumer webcam scanning dark surfaces, where OpenCV's decoder dropped too much: it rejects a whole pixel when any bit is unclear. Ours compares each pattern with its inverse per pixel, reads bits from coarse to fine and keeps the reliable coarse bits when fine ones are unclear, and then refines positions between stripes from neighboring pixels. That kept coverage usable on the real space, at the cost of owning the decoding code and its tests.

## Consequences

- Decoding behavior is tested with synthetic scenes and a local real-scan fixture, not delegated to OpenCV.
- OpenCV is still used for image work (blurs, edges, contours) in surface detection.
