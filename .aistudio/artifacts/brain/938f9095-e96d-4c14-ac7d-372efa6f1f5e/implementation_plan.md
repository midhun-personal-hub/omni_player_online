# Implementation Plan - Fix DraggableCallBadge Dragging

## Problem
The `DraggableCallBadge` dragging feature is not working properly because `badge.offsetParent` or `badge.parentElement` resolves to its immediate wrapper `div` (which has `absolute top-0 left-0 pointer-events-none`) rather than the actual player container (`VideoPlayer` or `GuestPlayer` container), leading to incorrect container dimensions and coordinate calculations.

## Proposed Changes
### `src/components/CallStrip.tsx`
- Update container lookup in `DraggableCallBadge` to search for the parent player container using `.closest('.relative')` or traversing up to the video player container instead of `offsetParent`.
- Ensure pointer move events calculate movement delta (`dx`, `dy`) and update `transform: translate3d(...)` relative to the player container correctly.
- Add window and fullscreen event handlers correctly bounding the badge inside the player.

## Verification Plan
- Compile and lint applet.
- Test dragging the badge in development preview across desktop and touch devices.
