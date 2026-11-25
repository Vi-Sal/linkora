import test from "node:test";
import assert from "node:assert/strict";
import { normalize, publicIP } from "../src/lib/server/urls";
import {
  editSchema,
  filename,
  qualityOptions,
  validateEdit,
} from "../src/lib/server/media";
import { translate } from "../src/lib/i18n";
import { terminal, type Media } from "../src/lib/models";
test("normalize supported YouTube entry points to a single video", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=yMINha31-uw&list=RDfojOImBOZeI&index=3",
    "https://youtu.be/yMINha31-uw?t=9",
    "https://music.youtube.com/watch?v=yMINha31-uw",
    "https://m.youtube.com/shorts/yMINha31-uw",
  ]) {
    assert.deepEqual(normalize(url), {
      platform: "YouTube",
      url: "https://www.youtube.com/watch?v=yMINha31-uw",
    });
  }
});
test("recognize TikTok and limit redirect entry points", () => {
  assert.equal(normalize("https://vm.tiktok.com/ZMy123/").short, true);
  assert.equal(
    normalize(
      "https://www.tiktok.com/@scout2015/video/6718335390845095173?tracking=true",
    ).url,
    "https://www.tiktok.com/@scout2015/video/6718335390845095173",
  );
  assert.throws(() => normalize("https://vm.tiktok.com/unrelated/path"));
});
test("reject unapproved destinations, credentials, ports and private address ranges", () => {
  for (const u of [
    "file:///tmp/song",
    "http://localhost/",
    "https://www.youtube.com.example.org/watch?v=yMINha31-uw",
    "https://name:pass@media.w3.org/media",
    "https://media.w3.org:8888/media",
    "https://youtube.com/playlist?list=123",
    "https://169.254.169.254/",
  ])
    assert.throws(() => normalize(u));
  for (const ip of [
    "127.0.0.1",
    "::1",
    "::ffff:192.168.2.1",
    "10.2.3.4",
    "fc00::1",
    "169.254.169.254",
    "224.0.0.1",
    "192.0.2.1",
  ])
    assert.equal(publicIP(ip), false);
  assert.equal(publicIP("1.1.1.1"), true);
});
test("quality discovery respects dimensions, audio tracks and available remux", () => {
  const q = qualityOptions(480, true, true, 20, true, 12345);
  assert.equal(q[0].estimate, 12345);
  assert(q.some((q) => q.id === "mp3-192" && q.estimate === 480000));
  assert(!q.some((q) => q.height === 720));
  assert(
    !qualityOptions(480, true, false, 20, true).some((q) => q.kind === "audio"),
  );
  assert(!filename("../../Trial.mp4", q[0]).includes("/"));
  const m = { formats: q, duration: 20 } as Media;
  assert.throws(() => validateEdit(m, q[0], editSchema.parse({ start: 22 })));
  assert.throws(() => editSchema.parse({ cmd: "invalid" }));
});
test("language and job states", () => {
  assert.equal(translate("km", "Home"), "ទំព័រដើម");
  assert.equal(terminal("PROCESSING"), false);
  assert.equal(terminal("EXPIRED"), true);
});
