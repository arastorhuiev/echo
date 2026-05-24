<script lang="ts">
  import { onMount, tick } from "svelte"
  import { API_BASE, providers, type Provider } from "../lib/providers"

  type Layout = "bottom" | "side"
  type EventRow = { tag: string; data: unknown; raw: string; t: number }

  let selectedId: string = $state(providers[0]!.id)
  const selected: Provider = $derived(providers.find((p) => p.id === selectedId) ?? providers[0]!)
  let values: Record<string, string> = $state({})
  let events: EventRow[] = $state([])
  let status: "idle" | "running" | "done" | "error" = $state("idle")
  let source: EventSource | null = $state(null)
  let lookupId: string | null = $state(null)
  let layout: Layout = $state("bottom")
  let listEl: HTMLOListElement | undefined = $state(undefined)

  onMount(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("echo-layout") : null
    if (saved === "side" || saved === "bottom") layout = saved
  })

  function setLayout(next: Layout) {
    layout = next
    if (typeof localStorage !== "undefined") localStorage.setItem("echo-layout", next)
  }

  $effect(() => {
    const map: Record<string, string> = {}
    for (const f of selected.fields) map[f.name] = f.default ?? ""
    values = map
  })

  // Auto-scroll the events list to the bottom whenever a new event lands.
  // Runs after the DOM update because `$effect` is scheduled post-render
  // and we await a tick to be safe with Svelte 5's batched scheduling.
  $effect(() => {
    events.length
    void tick().then(() => {
      if (listEl) listEl.scrollTop = listEl.scrollHeight
    })
  })

  function buildQuery(): Record<string, unknown> {
    const q: Record<string, unknown> = {}
    for (const f of selected.fields) {
      const v = values[f.name] ?? ""
      if (f.kind === "array")
        q[f.name] = v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      else q[f.name] = v
    }
    return q
  }

  function pushEvent(row: EventRow) {
    // Direct mutation on the $state proxy: nudges Svelte to flush this
    // event independently of any siblings, so the user perceives each
    // SSE frame landing one at a time rather than batched.
    events.push(row)
  }

  async function run() {
    if (status === "running") return
    events = []
    lookupId = null
    status = "running"

    try {
      const resp = await fetch(`${API_BASE}/lookups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: selected.id, query: buildQuery() }),
      })
      if (!resp.ok) {
        const text = await resp.text()
        pushEvent({ tag: "HTTP", data: { status: resp.status, body: text }, raw: text, t: Date.now() })
        status = "error"
        return
      }
      const body = (await resp.json()) as { id: string; streamUrl: string }
      lookupId = body.id
      const apiOrigin = API_BASE.replace(/\/api$/, "")
      const url = `${apiOrigin}${body.streamUrl}`
      source = new EventSource(url)
      source.onmessage = (ev: MessageEvent<string>) => {
        let parsed: unknown = ev.data
        try {
          parsed = JSON.parse(ev.data)
        } catch {}
        const tag =
          typeof parsed === "object" && parsed && "_tag" in parsed
            ? String((parsed as { _tag: string })._tag)
            : "Event"
        pushEvent({ tag, data: parsed, raw: ev.data, t: Date.now() })
        if (tag === "Final" || tag === "Failed") {
          source?.close()
          source = null
          status = tag === "Failed" ? "error" : "done"
        }
      }
      source.onerror = () => {
        if (status === "running") status = "error"
        source?.close()
        source = null
      }
    } catch (err) {
      pushEvent({
        tag: "Error",
        data: { message: String(err) },
        raw: String(err),
        t: Date.now(),
      })
      status = "error"
    }
  }

  async function cancel() {
    source?.close()
    source = null
    if (lookupId) {
      try {
        await fetch(`${API_BASE}/lookups/${lookupId}`, { method: "DELETE" })
      } catch {}
    }
    status = "idle"
  }

  function tagColour(tag: string): string {
    switch (tag) {
      case "Started":
        return "text-sky-300"
      case "Partial":
        return "text-zinc-200"
      case "Final":
        return "text-emerald-300"
      case "Failed":
        return "text-rose-300"
      default:
        return "text-zinc-300"
    }
  }
</script>

<div class={layout === "side" ? "grid gap-6 lg:grid-cols-[minmax(0,_1fr)_minmax(0,_1.4fr)] items-start" : "grid gap-6"}>
  <section class="grid gap-6 min-w-0">
    <div class="grid gap-2">
      <label for="provider" class="text-xs uppercase tracking-wider text-zinc-400">Provider</label>
      <select
        id="provider"
        bind:value={selectedId}
        class="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-100 focus:outline-none focus:border-zinc-500"
      >
        {#each providers as p (p.id)}
          <option value={p.id}>
            {p.id} · {p.category}{p.envConditional ? "  · needs env" : ""}
          </option>
        {/each}
      </select>
      <p class="text-sm text-zinc-400">{selected.description}</p>
    </div>

    <div class="grid gap-3">
      {#each selected.fields as f (f.name)}
        <label class="grid gap-1">
          <span class="text-xs uppercase tracking-wider text-zinc-400">{f.label}</span>
          <input
            type={f.type ?? "text"}
            bind:value={values[f.name]}
            class="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-100 font-mono text-sm focus:outline-none focus:border-zinc-500"
          />
          {#if f.hint}
            <span class="text-xs text-zinc-500">{f.hint}</span>
          {/if}
        </label>
      {/each}
    </div>

    <div class="flex items-center gap-2">
      <button
        onclick={run}
        disabled={status === "running"}
        class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors"
      >
        {status === "running" ? "Running…" : "Run"}
      </button>
      {#if status === "running"}
        <button
          onclick={cancel}
          class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded transition-colors"
        >
          Cancel
        </button>
      {/if}
      <span class="ml-auto text-sm text-zinc-400">
        status: <span class="font-mono text-zinc-200">{status}</span>
      </span>
    </div>

    {#if lookupId}
      <div class="text-xs text-zinc-500 font-mono break-all">
        lookup id: <span class="text-zinc-300">{lookupId}</span>
      </div>
    {/if}
  </section>

  <section class="grid gap-2 min-w-0">
    <div class="flex items-center gap-3">
      <div class="text-xs uppercase tracking-wider text-zinc-400">
        Events ({events.length})
      </div>
      {#if status === "running"}
        <span class="inline-flex items-center gap-1.5 text-xs text-emerald-300">
          <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          live
        </span>
      {/if}
      <div class="ml-auto inline-flex gap-1 text-xs bg-zinc-900 border border-zinc-800 rounded p-0.5">
        <button
          type="button"
          onclick={() => setLayout("bottom")}
          aria-pressed={layout === "bottom"}
          class={`px-2 py-1 rounded transition-colors ${layout === "bottom" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
        >
          Bottom
        </button>
        <button
          type="button"
          onclick={() => setLayout("side")}
          aria-pressed={layout === "side"}
          class={`px-2 py-1 rounded transition-colors ${layout === "side" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
        >
          Side
        </button>
      </div>
    </div>
    <ol
      bind:this={listEl}
      class={`grid gap-2 overflow-y-auto border border-zinc-800 rounded p-3 bg-zinc-950 ${
        layout === "side" ? "max-h-[70vh] lg:max-h-[78vh]" : "max-h-[60vh]"
      }`}
    >
      {#each events as e, idx (idx)}
        <li
          class={`font-mono text-xs ${idx === events.length - 1 ? "animate-pulse-once" : ""}`}
        >
          <div class="flex items-baseline gap-2">
            <span class={`uppercase tracking-wider ${tagColour(e.tag)}`}>{e.tag}</span>
            <span class="text-[10px] text-zinc-600">+{events.length > 0 && idx > 0 ? `${e.t - events[0]!.t}ms` : "0ms"}</span>
          </div>
          <pre class="whitespace-pre-wrap break-all text-zinc-200 mt-1">{JSON.stringify(e.data, null, 2)}</pre>
        </li>
      {/each}
      {#if events.length === 0}
        <li class="text-zinc-500 text-sm italic">No events yet — pick a provider and Run.</li>
      {/if}
    </ol>
  </section>
</div>

<style>
  @keyframes pulse-once {
    0% {
      background-color: rgb(63 63 70 / 0.6);
    }
    100% {
      background-color: transparent;
    }
  }
  :global(.animate-pulse-once) {
    animation: pulse-once 800ms ease-out;
    border-radius: 4px;
    padding: 2px 4px;
    margin: -2px -4px;
  }
</style>
