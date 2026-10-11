"use client";
import { ConnectionStyleDetails } from "./connection-style";
import type { Profile } from "../../../packages/generated-clients/client";
export const answerLabels = {
  smoking: { never: "Never", sometimes: "Sometimes", regularly: "Regularly" },
  drinking: { never: "Never", sometimes: "Sometimes", regularly: "Regularly" },
  children: {
    want: "Want children",
    do_not_want: "Do not want children",
    open: "Open to discussing",
  },
} as const;
const titles = {
  smoking: "Smoking",
  drinking: "Drinking",
  children: "Children in the future",
};
const visibility = {
  datingPace: "dating pace",
  dateVibes: "first-date preferences",
  openingQuestion: "opening question",
  age: "age",
  city: "city and approximate distance",
  gender: "gender",
  pronouns: "pronouns",
  languages: "languages",
  bio: "bio",
  prompt: "prompt",
  interests: "interests",
  education: "education",
  lifestyle: "lifestyle",
  futurePlans: "future plans",
  communication: "communication preferences",
  boundaries: "dating boundaries",
  smoking: "smoking answer",
  drinking: "drinking answer",
  children: "children answer",
} as const;
export function ProfilePreferences({
  profile,
  onChange,
}: {
  profile: Profile;
  onChange: (key: keyof Profile, value: unknown) => void;
}) {
  const hidden = profile.hiddenFields ?? [];
  return (
    <>
      <h2>A few everyday choices.</h2>
      <p className="muted">
        Optional, in your own control. You can hide these answers below.
        Discovery can use private answers to respect both people’s dealbreakers.
      </p>
      <div className="field-grid">
        {(Object.keys(answerLabels) as (keyof typeof answerLabels)[]).map(
          (key) => (
            <div key={key}>
              <label htmlFor={"answer-" + key}>{titles[key]}</label>
              <select
                id={"answer-" + key}
                value={profile[key] ?? ""}
                onChange={(e) => onChange(key, e.target.value)}
              >
                <option value="">Not shared</option>
                {Object.entries(answerLabels[key]).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ),
        )}
      </div>
      <details className="profile-options">
        <summary>Your dealbreakers</summary>
        <p className="muted">
          Select the answers you are open to. Leave a category unchecked for no
          restriction. A selected category excludes unanswered profiles. Both
          people’s choices must fit; these preferences are private.
        </p>
        {(Object.keys(answerLabels) as (keyof typeof answerLabels)[]).map(
          (key) => (
            <fieldset key={key}>
              <legend>{titles[key]} you are open to</legend>
              {Object.entries(answerLabels[key]).map(([value, label]) => (
                <label key={value} className="check">
                  <input
                    type="checkbox"
                    checked={
                      (
                        profile.dealbreakers?.[key] as string[] | undefined
                      )?.includes(value) ?? false
                    }
                    onChange={(e) => {
                      const old = profile.dealbreakers?.[key] ?? [];
                      onChange("dealbreakers", {
                        ...profile.dealbreakers,
                        [key]: e.target.checked
                          ? [...old, value]
                          : old.filter((x) => x !== value),
                      });
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          ),
        )}
      </details>
      <details className="profile-options">
        <summary>Choose what others see</summary>
        <p className="muted">
          Your display name, intention and approved photo stay visible. Hiding
          an answer removes it from profiles and shared-interest explanations.
          Age and city still apply privately to eligibility and matching
          filters. Privacy controls are free and stay in effect when a
          membership ends. Work and height have their own controls below.
        </p>
        {Object.entries(visibility).map(([key, label]) => (
          <label className="check" key={key}>
            <input
              type="checkbox"
              checked={!hidden.includes(key as (typeof hidden)[number])}
              onChange={(e) =>
                onChange(
                  "hiddenFields",
                  e.target.checked
                    ? hidden.filter((x) => x !== key)
                    : [...hidden, key],
                )
              }
            />
            Show {label} on my public profile
          </label>
        ))}
      </details>
    </>
  );
}
export function ProfileDetails({ profile }: { profile: Partial<Profile> }) {
  const details: [string, string | undefined][] = [
    ["Work", profile.work],
    ["Height", profile.heightCm ? `${profile.heightCm} cm` : ""],
    ["Education", profile.education],
    ["Languages", profile.languages?.filter(Boolean).join(" · ")],
    ["Lifestyle", profile.lifestyle],
    ["Future plans", profile.futurePlans],
    ["Communication", profile.communication],
    ["Boundaries", profile.boundaries],
    ...(Object.keys(answerLabels) as (keyof typeof answerLabels)[]).map(
      (key) =>
        [
          titles[key],
          profile[key]
            ? (answerLabels[key] as Record<string, string>)[profile[key]!]
            : "",
        ] as [string, string],
    ),
  ];
  return (
    <>
      <ConnectionStyleDetails profile={profile} />
      <dl>
        {details
          .filter(([, value]) => !!value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </>
  );
}
