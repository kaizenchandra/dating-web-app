"use client";
import { useState } from "react";
import type {
  Profile,
  Candidate,
} from "../../../packages/generated-clients/client";
export const paceLabels = {
  slow_and_steady: "Slow and steady",
  chat_then_meet: "Chat, then plan a date",
  meet_soon: "Open to meeting soon",
} as const;
export const vibeLabels = {
  chai_coffee: "Chai or coffee",
  food_walk: "A food walk",
  arts_culture: "Art, books or culture",
  outdoors: "A public outdoor walk",
  games: "Games and quizzes",
  video_first: "A video hello first",
} as const;
export function ConnectionStyleEditor({
  profile,
  onChange,
}: {
  profile: Profile;
  onChange: (key: keyof Profile, value: unknown) => void;
}) {
  const vibes = profile.dateVibes || [];
  return (
    <section className="form-stack" aria-label="Your connection style">
      <h2>Your kind of connection.</h2>
      <p className="muted">
        Share what feels comfortable now. Preferences are invitations, never
        promises or consent.
      </p>
      <label htmlFor="dating-pace">My dating pace</label>
      <select
        id="dating-pace"
        value={profile.datingPace || ""}
        onChange={(e) => onChange("datingPace", e.target.value)}
      >
        <option value="">Prefer not to say</option>
        {Object.entries(paceLabels).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <fieldset>
        <legend>First dates I enjoy (up to 3)</legend>
        {Object.entries(vibeLabels).map(([key, label]) => (
          <label className="check" key={key}>
            <input
              type="checkbox"
              checked={vibes.includes(key as (typeof vibes)[number])}
              disabled={
                vibes.length >= 3 &&
                !vibes.includes(key as (typeof vibes)[number])
              }
              onChange={(e) =>
                onChange(
                  "dateVibes",
                  e.target.checked
                    ? [...vibes, key]
                    : vibes.filter((v) => v !== key),
                )
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label htmlFor="opening-question">A question someone can answer</label>
      <textarea
        id="opening-question"
        maxLength={180}
        rows={2}
        value={profile.openingQuestion || ""}
        placeholder="Which small adventure would you plan for a Sunday?"
        onChange={(e) => onChange("openingQuestion", e.target.value)}
      />
      <label htmlFor="introduction-policy">
        Who can send me a direct introduction?
      </label>
      <select
        id="introduction-policy"
        value={profile.introductionPolicy || "everyone"}
        onChange={(e) => onChange("introductionPolicy", e.target.value)}
      >
        <option value="everyone">Eligible people before matching</option>
        <option value="matches_only">Only people I have matched with</option>
      </select>
      <p className="muted">
        People can still send a plain interest. Private chat always needs a
        mutual match. This control is free.
      </p>
    </section>
  );
}
export function ConnectionStyleDetails({
  profile,
}: {
  profile: Partial<Profile>;
}) {
  return (
    <>
      {profile.datingPace && (
        <p>
          <strong>My pace:</strong> {paceLabels[profile.datingPace]}
        </p>
      )}
      {!!profile.dateVibes?.length && (
        <div className="interest-tags" aria-label="First-date preferences">
          {profile.dateVibes.map((v) => (
            <span key={v}>{vibeLabels[v]}</span>
          ))}
        </div>
      )}
      {profile.openingQuestion && (
        <blockquote>
          <span>A question for you</span>
          <p>{profile.openingQuestion}</p>
        </blockquote>
      )}
    </>
  );
}
export function IntroductionComposer({ person }: { person: Candidate }) {
  const [text, setText] = useState("");
  const closed = person.introductionPolicy === "matches_only";
  const first = person.sharedInterests?.[0];
  const draft = first
    ? `We both enjoy ${first}. What got you into it?`
    : "What is a small thing you are looking forward to this week?";
  return (
    <>
      {closed ? (
        <p className="local-notice">
          This person prefers text after matching. Send an interest now; you can
          chat if they accept.
        </p>
      ) : (
        <>
          <p className="muted">
            A starting point, in your own words. Edit before sending.
          </p>
          <div className="camera-actions">
            {person.openingQuestion && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setText(`About your question “${person.openingQuestion}”: `)
                }
              >
                Answer their question
              </button>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => setText(draft)}
            >
              {first
                ? "Ask about a shared interest"
                : "Try a conversation starter"}
            </button>
          </div>
        </>
      )}
      <label htmlFor="introduction">Direct introduction (optional)</label>
      <textarea
        id="introduction"
        name="introduction"
        rows={3}
        maxLength={500}
        value={closed ? "" : text}
        disabled={closed}
        onChange={(e) => setText(e.target.value)}
        placeholder="A thoughtful question is a lovely place to start."
      />
    </>
  );
}
