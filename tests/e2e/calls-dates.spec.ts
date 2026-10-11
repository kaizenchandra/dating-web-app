import { test, expect, chromium, type Page } from "@playwright/test";
import {
  member,
  resetOtp,
  connection,
  origin,
} from "../../packages/test-fixtures/browser";
test.beforeAll(() => resetOtp(["+916000000009", "+916000000010"]));
async function received(page: Page, kind: string) {
  return page.evaluate(async (kind) => {
    const peers =
      (window as unknown as { testPeers: RTCPeerConnection[] }).testPeers || [];
    let bytes = 0;
    for (const pc of peers) {
      const stats = await pc.getStats();
      stats.forEach((s) => {
        if (
          s.type === "inbound-rtp" &&
          (s.kind === kind || s.mediaType === kind)
        )
          bytes += Number(s.bytesReceived || 0);
      });
    }
    return bytes;
  }, kind);
}
test("real WebRTC media flows between two independent browser processes; date consent persists", async () => {
  test.setTimeout(120000);
  const args = [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ];
  const browserA = await chromium.launch({ args });
  const browserB = await chromium.launch({ args });
  try {
    const a = await member(browserA, "+916000000009", "Naina", "Woman");
    const b = await member(browserB, "+916000000010", "Rohan", "Man");
    for (const user of [a, b]) {
      await user.context.grantPermissions(["camera", "microphone"]);
      await user.context.addInitScript(() => {
        const Original = window.RTCPeerConnection;
        (window as unknown as { testPeers: RTCPeerConnection[] }).testPeers =
          [];
        window.RTCPeerConnection = class extends Original {
          constructor(config?: RTCConfiguration) {
            super(config);
            (
              window as unknown as { testPeers: RTCPeerConnection[] }
            ).testPeers.push(this);
          }
        };
      });
    }
    await connection(a.context, b.id, "unblock");
    await connection(b.context, a.id, "unblock");
    await connection(a.context, b.id, "unmatch");
    await connection(a.context, b.id, "like");
    const match = await (await connection(b.context, a.id, "like")).json();
    const id = match.matchId;
    expect(id).toBeTruthy();
    await b.context.request.put(origin + "/api/v1/account/wellbeing", {
      headers: { origin },
      data: {
        locale: "en",
        quietEnabled: true,
        quietStart: 0,
        quietEnd: 0,
        readReceipts: false,
      },
    });
    expect(
      (
        await a.context.request.post(origin + "/api/v1/calls", {
          headers: { origin },
          data: { conversationId: id },
        })
      ).status(),
    ).toBe(409);
    await b.context.request.put(origin + "/api/v1/account/wellbeing", {
      headers: { origin },
      data: {
        locale: "en",
        quietEnabled: false,
        quietStart: 22,
        quietEnd: 8,
        readReceipts: false,
      },
    });
    await a.page.goto("/inbox?match=" + id);
    await a.page
      .getByRole("link", { name: "Video / audio call", exact: true })
      .click();
    await b.page.goto("/inbox?match=" + id);
    await a.page
      .getByRole("button", { name: "Invite to audio call", exact: true })
      .click();
    await b.page
      .getByRole("link", { name: "Review call invitation", exact: true })
      .click();
    await b.page
      .getByRole("button", { name: "Accept audio call", exact: true })
      .click();
    await expect(
      a.page.getByText("Media connected", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      b.page.getByText("Media connected", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect
      .poll(() => received(a.page, "audio"), { timeout: 20000 })
      .toBeGreaterThan(0);
    await expect
      .poll(() => received(b.page, "audio"), { timeout: 20000 })
      .toBeGreaterThan(0);
    if (process.env.EXPECT_TURN_RELAY === "1") {
      for (const user of [a, b]) {
        const config = await (
          await user.context.request.get(
            origin + "/api/v1/calls/config?conversationId=" + id,
          )
        ).json();
        expect(config.iceTransportPolicy).toBe("relay");
        expect(config.expiresIn).toBe(600);
        await expect
          .poll(() =>
            user.page.evaluate(async () => {
              for (const pc of (
                window as unknown as { testPeers: RTCPeerConnection[] }
              ).testPeers) {
                const stats = await pc.getStats();
                let relay = false;
                stats.forEach((s) => {
                  if (s.type === "transport" && s.selectedCandidatePairId) {
                    const pair = stats.get(s.selectedCandidatePairId);
                    const local = pair && stats.get(pair.localCandidateId);
                    if (local?.candidateType === "relay") relay = true;
                  }
                });
                if (relay) return true;
              }
              return false;
            }),
          )
          .toBe(true);
      }
    }
    await a.page
      .getByRole("button", { name: "Preview camera", exact: true })
      .click();
    await a.page
      .getByRole("button", { name: "Share camera", exact: true })
      .click();
    await expect
      .poll(() => received(b.page, "video"), { timeout: 20000 })
      .toBeGreaterThan(0);
    await a.page
      .getByRole("button", { name: "Camera off", exact: true })
      .click();
    await a.page.getByRole("button", { name: "Mute", exact: true }).click();
    await expect(
      a.page.getByRole("button", { name: "Unmute", exact: true }),
    ).toBeVisible();
    await a.page.getByRole("button", { name: "End call", exact: true }).click();
    await expect(b.page.getByText("Call ended", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await a.page.getByRole("button", { name: "Save private feedback" }).click();
    await expect(
      a.page.getByText("Your private feedback is saved."),
    ).toBeVisible();
    await a.page.goto("/dates?match=" + id);
    await b.page.goto("/dates?match=" + id);
    await a.page
      .getByLabel("Public venue", { exact: true })
      .fill("The Reading Room Café");
    await a.page
      .getByLabel("Venue address", { exact: true })
      .fill("MG Road, Bengaluru, public café");
    const date = new Date(Date.now() + 86400000 * 2);
    const localDate = new Date(
      date.getTime() - date.getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 16);
    await a.page.getByLabel("Date & time", { exact: true }).fill(localDate);
    await a.page.getByRole("checkbox").check();
    await a.page.getByRole("button", { name: "Send date invitation" }).click();
    await expect(
      a.page.getByText(
        "Your date invitation is saved. It needs their acceptance.",
      ),
    ).toBeVisible();
    await b.page
      .getByRole("button", { name: "Accept plan", exact: true })
      .click();
    await expect(
      b.page.getByText("Plan accepted.", { exact: true }),
    ).toBeVisible();
    await a.page.reload();
    await expect(a.page.getByText("accepted", { exact: true })).toBeVisible();
    await a.page
      .getByRole("button", { name: "Preview trusted-contact share" })
      .click();
    await expect(
      a.page.getByRole("region", { name: "Trusted contact share preview" }),
    ).toContainText("The Reading Room Café");
    await a.page.getByRole("button", { name: "Cancel sharing" }).click();
    await a.page
      .getByRole("button", { name: "I’ve arrived", exact: true })
      .click();
    await expect(
      a.page.getByText("Your “arrived” check-in is saved."),
    ).toBeVisible();
    const plans = await (
      await a.context.request.get(origin + "/api/v1/dates?conversationId=" + id)
    ).json();
    expect(plans.plans[0].status).toBe("accepted");
  } finally {
    await browserA.close();
    await browserB.close();
  }
});
