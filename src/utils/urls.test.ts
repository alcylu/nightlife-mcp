import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventUrl,
  buildPerformerUrl,
  buildVenueUrl,
} from "./urls.js";

test("public URLs use the canonical unprefixed English routes", () => {
  assert.equal(
    buildEventUrl("https://nightlifetokyo.com/", "tokyo", "event-id"),
    "https://nightlifetokyo.com/tokyo/events/event-id",
  );
  assert.equal(
    buildVenueUrl("https://nightlifetokyo.com", "tokyo", "venue-id"),
    "https://nightlifetokyo.com/tokyo/venues/venue-id",
  );
  assert.equal(
    buildPerformerUrl("https://nightlifetokyo.com", "tokyo", "dj-name", "DJ"),
    "https://nightlifetokyo.com/tokyo/djs/dj-name",
  );
  assert.equal(
    buildPerformerUrl(
      "https://nightlifetokyo.com",
      "tokyo",
      "visual-name",
      "Visual Artist",
    ),
    "https://nightlifetokyo.com/tokyo/visual-artists/visual-name",
  );
});
