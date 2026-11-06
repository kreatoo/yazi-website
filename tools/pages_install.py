from html import escape


def snippet(command: str, label: str) -> str:
    return f'''<div class="snippet" data-copy-host>
              <code class="snippet__code">{escape(command)}</code>
              <button class="snippet__copy" type="button" data-copy aria-label="{escape(label)}" hidden>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                <span class="snippet__copy-text">Copy</span>
              </button>
            </div>
            <p class="snippet__feedback sr-only" role="status" data-copy-feedback></p>'''


UNIX_BUILD = """go build -trimpath -o yazi ./cmd/yazi
go build -trimpath -o yazi-runtime ./cmd/yazi-runtime"""
INSTALL_CMD = "curl -fsSL https://yazi.krea.to/install.sh | bash"
INSTALL_READ_FIRST = (
    "curl -fsSL https://yazi.krea.to/install.sh -o install.sh"
    " && less install.sh && bash install.sh"
)
FIRST_TASK = 'yazi -p "Reply with the words Yazi is ready."'

INSTALL = rf"""
  <section class="pagehead">
    <div class="wrap">
      <h1 class="pagehead__title" data-split>
        <span class="line">Install and</span>
        <span class="line">run Yazi.</span>
      </h1>
      <p class="pagehead__lede">One command to install. Connect a provider, run a task.</p>
      <nav class="page-jumps" aria-label="On this page">
        <a href="#steps">Quickstart</a>
        <a href="#from-source">Build from source</a>
        <a href="#commands">Command reference</a>
      </nav>
    </div>
  </section>

  <section class="section section--rule" id="steps">
    <div class="wrap">
      <ol class="steps">

        <li class="step" id="platform">
          <div class="step__body">
            <h2 class="step__title">Install with one command</h2>
            <p class="step__text">
              The installer clones the Yazi repository, builds <code>yazi</code>
              and <code>yazi-runtime</code>, and links both into
              <code>~/.local/bin</code>. It needs git and curl, not Go: if Go is
              missing or too old, it fetches a toolchain just for the build.
              Run it again to update.
            </p>
            {snippet(INSTALL_CMD, "Copy install command")}
            <p class="step__text step__text--dim">
              To read it first:
              <code>{escape(INSTALL_READ_FIRST)}</code>
            </p>
            <p class="step__text step__text--dim">
              Options go after <code>bash -s --</code>: <code>--ref</code> pins a
              branch, tag or commit, <code>--dir</code> and <code>--bin-dir</code>
              move the install, <code>--uninstall</code> removes it.
              <code>--help</code> lists the rest.
            </p>
          </div>
          <div class="step__aside">
            <ul class="plat-list">
              <li class="plat">
                <span class="plat__os">Linux</span>
                <span class="plat__arch mono">amd64 · arm64</span>
                <span class="plat__note">No glibc dependency. Runs on glibc and musl.</span>
              </li>
              <li class="plat">
                <span class="plat__os">macOS</span>
                <span class="plat__arch mono">amd64 · arm64</span>
                <span class="plat__note">arm64 for Apple silicon, amd64 for Intel.</span>
              </li>
            </ul>
          </div>
        </li>

        <li class="step" id="provider">
          <div class="step__body">
            <h2 class="step__title">Connect a provider</h2>
            <p class="step__text">
              Start Yazi and run <code>/login</code> at the prompt. It supports
              OpenAI, Anthropic, Google, Amazon Bedrock, Mistral and any
              compatible endpoint. Keys are stored once, in
              <code>auth.json</code>.
            </p>
            {snippet("yazi", "Copy launch command")}
          </div>
        </li>

        <li class="step" id="first-task">
          <div class="step__body">
            <h2 class="step__title">Run a task</h2>
            <p class="step__text">
              A one-shot run is the quickest way to check the whole chain works.
              A correct answer contains <strong>Yazi is ready.</strong>
            </p>
            {snippet(FIRST_TASK, "Copy first task command")}
            <p class="step__text step__text--dim">
              If <code>yazi</code> is not found, its directory is not on
              <code>PATH</code>. If it starts but the task fails, run
              <code>yazi doctor</code> and check the provider credentials and
              model access.
            </p>
          </div>
        </li>

      </ol>

      <details class="source" id="from-source">
        <summary>
          <span class="source__label">Build from source</span>
          <span class="source__hint mono">Go 1.26</span>
        </summary>
        <div class="source__body">
          <p class="step__text">
            From the root of a local checkout of the
            <a href="https://src.krea.to/kreato/yazi">Yazi repository</a>.
            Keep the two outputs together and add their directory to your
            <code>PATH</code>. The installer does exactly this.
          </p>
          {snippet(UNIX_BUILD, "Copy build commands")}
          <p class="step__text step__text--dim">
            With Nix, run <code>nix run .#</code> from the repository instead.
            A native SQLite/FTS5 build needs CGO and
            <code>-tags 'yazi_sqlite_cgo sqlite_fts5'</code>.
          </p>
        </div>
      </details>

      <p class="install__caveat">
        Yazi is under active development. Rebuilding context from a checkpoint
        applies to tracked tasks (a task from a spec attached with
        <code>/spec</code>); other sessions use ordinary compaction and resume
        from their transcript.
        OS, terminal and sandbox compatibility can vary by build.
      </p>
    </div>
  </section>

  <section class="section section--rule" id="commands">
    <div class="wrap">
      <header class="section__head" data-reveal>
        <h2 class="h2">Command reference</h2>
      </header>

      <div class="codegrid">
        <figure class="code" data-reveal>
          <figcaption class="code__bar"><span class="mono">shell</span><span class="mono code__bar-note">sessions</span></figcaption>
<pre><code>yazi                     <span class="c-com"># interactive</span>
yazi -p <span class="c-str">"run the tests"</span>  <span class="c-com"># one shot</span>
yazi --continue          <span class="c-com"># resume latest</span>
yazi --resume &lt;id&gt;       <span class="c-com"># resume by id</span>
yazi --resume &lt;id&gt; --fork</code></pre>
        </figure>

        <figure class="code" data-reveal>
          <figcaption class="code__bar"><span class="mono">shell</span><span class="mono code__bar-note">control</span></figcaption>
<pre><code>yazi agents              <span class="c-com"># active work</span>
yazi list                <span class="c-com"># saved sessions</span>
yazi attach &lt;id&gt;
yazi send &lt;id&gt; <span class="c-str">"keep going"</span>
yazi stop &lt;id&gt;</code></pre>
        </figure>

        <figure class="code" data-reveal>
          <figcaption class="code__bar"><span class="mono">shell</span><span class="mono code__bar-note">remote</span></figcaption>
<pre><code>yazi endpoint add buildbox user@buildbox \
  --remote-cwd /home/user/project
yazi endpoint test buildbox
yazi --endpoint buildbox</code></pre>
        </figure>

        <figure class="code" data-reveal>
          <figcaption class="code__bar"><span class="mono">shell</span><span class="mono code__bar-note">operations</span></figcaption>
<pre><code>yazi doctor              <span class="c-com"># diagnose</span>
yazi status
yazi schedule list
yazi shutdown
yazi --mode rpc          <span class="c-com"># machine-readable</span></code></pre>
        </figure>
      </div>
    </div>
  </section>

  <section class="section section--rule" id="next">
    <div class="wrap">
      <div class="next" data-reveal>
        <div class="next__text">
          <h2 class="h2">Explore Yazi</h2>
        </div>
        <div class="next__links">
          <a class="next__link" href="index.html#mechanisms">
            <span class="next__label">How it works</span>
            <span class="next__desc">Fresh context, owned work, learning from runs.</span>
          </a>
          <a class="next__link" href="index.html#features">
            <span class="next__label">Features</span>
            <span class="next__desc">Resume, remote machines, subagents, the sandbox and more.</span>
          </a>
        </div>
      </div>
    </div>
  </section>
"""
