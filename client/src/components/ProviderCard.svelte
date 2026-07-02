<script lang="ts">
  export let primaryText: string;
  export let connected = false;
  export let href: string;
  export let icon = '';
  export let details: Array<{ label: string; value?: string | string[] }> = [];

  function formatValue(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return value.join(', ');
    return value ?? '';
  }

  function hasValue(value: string | string[] | undefined): boolean {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  }
</script>

<div class="panel flex w-full flex-col gap-3">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex flex-row items-center gap-3">
      {#if icon}
        <img class="size-12 shrink-0 grow-0 select-none rounded-full bg-white object-cover p-0.5" src={icon} alt="" draggable="false" />
      {:else}
        <span class="flex size-12 shrink-0 grow-0 select-none rounded-full bg-gray-300"></span>
      {/if}
      <p class="font-medium">{primaryText}</p>
    </div>
    <div class="order-3 w-full sm:order-none sm:w-auto">
      {#if connected}
        <span class="inline-flex h-fit w-full select-none items-center justify-center gap-1 rounded-xl border-2 border-primary bg-surface-050 px-4 py-2 text-center text-primary sm:w-auto">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.36 6.77-4.1 4.1a.75.75 0 0 1-1.06 0l-1.8-1.8a.75.75 0 0 1 1.06-1.06l1.27 1.27 3.57-3.57a.75.75 0 1 1 1.06 1.06Z" />
          </svg>
          Connected
        </span>
      {:else}
        <a class="inline-flex h-fit w-full select-none justify-center rounded-xl bg-gray-100 px-4 py-2 text-center text-black no-underline hover:bg-gray-300 hover:text-black sm:w-auto" href={href}>Sign in</a>
      {/if}
    </div>
  </div>
  {#if details.length > 0}
    <hr class="border-1 border-surface-150" />
    <ul class="flex flex-col gap-1 text-sm text-gray-400">
      {#each details as detail}
        <li class="flex items-baseline gap-1">
          {#if connected && hasValue(detail.value)}
            <span class="inline-flex shrink-0 self-center text-primary" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.36 6.77-4.1 4.1a.75.75 0 0 1-1.06 0l-1.8-1.8a.75.75 0 0 1 1.06-1.06l1.27 1.27 3.57-3.57a.75.75 0 1 1 1.06 1.06Z" />
              </svg>
            </span>
            <span class="text-primary">{detail.label}: {formatValue(detail.value)}</span>
          {:else}
            <span class="inline-flex shrink-0 self-center text-gray-500" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Z" />
              </svg>
            </span>
            <span class="text-gray-400">{detail.label}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
