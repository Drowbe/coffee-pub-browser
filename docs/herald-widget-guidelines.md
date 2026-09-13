# Making a Herald widget capturable by Coffee Pub Studio

Studio turns part of the Foundry stream page into its own OBS source by measuring one element
with a CSS selector, then cropping the window capture to that element's box. It re-measures on
every sync, so the crop follows the element if it moves. A few habits make that reliable.

1. **Give the widget one root element with a stable hook.** An id such as `#herald-stats`, or a
   class of its own such as `.herald-stats-widget`. Studio matches the selector against the live
   page, so the hook must survive re-renders and module updates. Do not rely on Foundry's
   generated ids or on element order.

2. **Everything the viewer should see goes inside that root.** Padding, background, borders and
   titles included. The crop is the root's bounding box; anything drawn outside it is cut off.
   Box shadows, glows and absolutely positioned children that poke past the edge are lost, so
   keep them inside or drop them.

3. **Keep the box a fixed size.** Set an explicit width and height, or a min-height, so the crop
   does not jump when the numbers change. Growing text should scroll or truncate inside the box,
   never resize it. Whole pixels help; avoid fractional sizes from percentages where you can.

4. **Keep it in one place.** Fixed or absolute position on the stream page is ideal. If it must
   sit in a flowing layout, make sure nothing above it changes height, or the widget slides and
   the crop is briefly wrong until the next sync.

5. **Hide, do not remove.** When the widget has nothing to show, keep the element in the page and
   hide it with visibility, opacity, or an empty state inside the box. Removing it makes the
   selector fail and OBS keeps the last crop over whatever is now underneath.

6. **No transforms, no motion of the box.** Slide-ins, scale animations and rotation change the
   measured rectangle mid-animation. Animate the contents if you like, never the root.

7. **Nothing on top of it.** OBS captures pixels, not elements. A tooltip, dialog or chat bubble
   that overlaps the widget is recorded. Keep its z-index above anything that can wander over it.

8. **Render on the stream view.** The widget has to exist on the page Studio captures, which for
   us is the `/stream` view, logged in as the observer user. Check it renders there, not only for
   the GM.

9. **Background is your choice.** The crop shows the widget exactly as drawn, including a
   transparent or semi-transparent background over the page behind it. An opaque background gives
   a clean source; a transparent one lets OBS compositing show through.

## Testing

Start the Stream window in Studio, add a region on its tab, choose **CSS selector**, enter your
selector and click **Measure**. The measured position and size should match the box you
intended, and the source in OBS should show only the widget.
