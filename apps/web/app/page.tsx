import Link from "next/link";
export default function Home() {
  return (
    <main>
      <header>
        <Link className="brand" href="/">
          raahi<span>✳</span>
        </Link>
        <a className="text-link" href="#approach">
          Our approach ↗
        </a>
      </header>
      <section className="hero">
        <p className="eyebrow">A LITTLE INTENTION. A REAL CONNECTION.</p>
        <h1>
          Make room for
          <br />
          someone <em>real.</em>
        </h1>
        <p className="intro">
          For the long conversations. The shared little rituals. The person who
          makes an ordinary Tuesday feel like something.
        </p>
        <div className="hero-actions">
          <Link className="button" href="/login">
            Begin your introduction <span>↗</span>
          </Link>
          <span className="muted">Built for India · Adults 18+</span>
        </div>
        <div className="orbit" aria-hidden="true">
          <div className="orbit-ring" />
          <span className="spark">✳</span>
          <div className="note note-one">More than a “hey.”</div>
          <div className="note note-two">Your pace. Your person.</div>
        </div>
      </section>
      <section id="approach" className="principles">
        <div>
          <span className="number">01 / INTENTION</span>
          <h2>A little more you.</h2>
          <p>
            Space for your stories, your boundaries, and what you’re actually
            looking for.
          </p>
        </div>
        <div>
          <span className="number">02 / CONNECTION</span>
          <h2>Meet in the middle.</h2>
          <p>
            Mutual interest is where a conversation begins. Taking the next step
            should be a choice.
          </p>
        </div>
        <div>
          <span className="number">03 / CONTROL</span>
          <h2>At your own pace.</h2>
          <p>
            Privacy and essential safety controls belong to everyone. They won’t
            sit behind a paywall.
          </p>
        </div>
      </section>
      <footer>
        <span>raahi · A new way to find your way together.</span>
        <Link href="/status">Platform status · Development preview</Link>
      </footer>
    </main>
  );
}
