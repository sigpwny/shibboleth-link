<script lang="ts">
  import ErrorPanel from './ErrorPanel.svelte';

  const params = new URLSearchParams(window.location.search);
  const server = params.get('server');
  const ok = params.get('success') === '1';
</script>

<div class="container px-4">
  <div class="mx-auto flex max-w-lg flex-col gap-4 pt-8 text-center">
    <h1 class="text-4xl font-bold">Shibboleth Link</h1>
    {#if ok}
      <div class="panel border-primary bg-green-950/30 text-white">
        <div class="mb-3 flex justify-center text-primary" aria-hidden="true">
          <svg width="56" height="56" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.36 6.77-4.1 4.1a.75.75 0 0 1-1.06 0l-1.8-1.8a.75.75 0 0 1 1.06-1.06l1.27 1.27 3.57-3.57a.75.75 0 1 1 1.06 1.06Z" />
          </svg>
        </div>
        <p class="text-lg font-semibold">Role granted successfully.</p>
        <p class="mt-2">You can now close this page.</p>
      </div>
      {#if server}
        <a class="self-center" href={`/link?server=${encodeURIComponent(server)}`}>Return to link page</a>
      {/if}
    {:else}
      <ErrorPanel message="This linking session expired, please try again." />
      {#if server}
        <a class="self-center select-none rounded-xl bg-primary px-4 py-2 text-black no-underline hover:bg-secondary hover:text-black" href={`/link?server=${encodeURIComponent(server)}`}>Try again</a>
      {/if}
    {/if}
  </div>
</div>
