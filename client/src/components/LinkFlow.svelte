<script lang="ts">
import ProviderCard from './ProviderCard.svelte';
import ErrorPanel from './ErrorPanel.svelte';
import { errorDetails, messageFor } from '@/lib/messages';
  import { serviceDefaults } from '@/lib/services';
  import { siteConfig } from '@/lib/site';

  export let apiBase: string;

  type AssertionDefinition = {
    key: 'uid' | 'eduPersonAffiliation';
    oid: string;
    name: string;
    friendlyName: string;
    description: string;
    required: boolean;
    valueKind: 'string' | 'string[]';
  };

  type LinkStatus = {
    server: {
      guildId: string;
      name: string;
      iconUrl?: string;
      mode: 'confirm_only' | 'link_and_store';
      verified: boolean;
      linkingEnabled: boolean;
    };
    services: {
      shibboleth: {
        name: string;
        icon: string;
        assertions: AssertionDefinition[];
      };
      discord: {
        name: string;
        icon: string;
      };
    };
    flow: {
      step: string;
      expiresAt: number;
    };
    shibboleth: {
      signedIn: boolean;
      assertions: {
        uid?: string;
        eduPersonAffiliation?: string[];
      };
    };
    discord: {
      signedIn: boolean;
      username?: string;
      userId?: string;
    };
    canConfirm: boolean;
    linkingEnabled?: boolean;
  };

  let status: LinkStatus | null = null;
  let loading = true;
  let submitting = false;
  let error = '';
  let errorCode = '';
  let server = '';
  let showLinkInstructions = false;

  const params = new URLSearchParams(window.location.search);
  server = params.get('server') ?? '';
  ({ message: error, code: errorCode } = errorDetails(params.get('error')));

  async function loadStatus() {
    if (!server) {
      showLinkInstructions = true;
      errorCode = 'WEB_MISSING_SERVER';
      loading = false;
      return;
    }

    const response = await fetch(`${apiBase}/api/link/session?server=${encodeURIComponent(server)}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      showLinkInstructions = response.status === 404;
      if (response.status === 404) {
        error = 'Unknown Discord server.';
        errorCode = 'WEB_UNKNOWN_SERVER';
      } else if (body.error) {
        ({ message: error, code: errorCode } = errorDetails(body.error));
      } else {
        error = 'Please report this error to the Shibboleth Link operator: Failed to load link status.';
        errorCode = 'WEB_LINK_STATUS_LOAD_FAILED';
      }
      loading = false;
      return;
    }

    status = await response.json();
    loading = false;

    const connected = params.get('connected');
    const next = params.get('next');
    if (connected && next === 'shib' && !status?.shibboleth.signedIn) {
      window.location.href = `${apiBase}/api/saml/start?server=${encodeURIComponent(server)}`;
    }
    if (connected && next === 'discord' && !status?.discord.signedIn) {
      window.location.href = `${apiBase}/api/discord/start?server=${encodeURIComponent(server)}`;
    }
  }

  function assertionValue(assertion: AssertionDefinition): string | string[] | undefined {
    return status?.shibboleth.assertions[assertion.key];
  }

  function shibbolethDetails() {
    return status?.services.shibboleth.assertions.map((assertion) => ({
      label: status.server.mode === 'confirm_only' && assertion.key === 'uid' ? 'NetID (not shared)' : assertion.friendlyName,
      value: assertionValue(assertion),
    })) ?? [];
  }

  function discordDetails() {
    const username = status?.discord.username
      ? status.discord.username.startsWith('@') ? status.discord.username : `@${status.discord.username}`
      : undefined;
    return [{ label: 'Username', value: username }];
  }

  async function confirmLink() {
    if (!server) return;
    submitting = true;
    error = '';
    errorCode = '';

    const response = await fetch(`${apiBase}/api/link/confirm?server=${encodeURIComponent(server)}`, {
      method: 'POST',
      credentials: 'include',
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      ({ message: error, code: errorCode } = errorDetails(body.code ?? body.error ?? 'unknown'));
      submitting = false;
      return;
    }

    submitting = false;
    window.location.href = `/confirm?server=${encodeURIComponent(server)}&success=1`;
  }

  loadStatus();
</script>

<div class="container px-4">
  <div class="mx-auto flex max-w-lg flex-col gap-4 pt-8">
    <div class="text-center font-bold">
      <h1 class="text-4xl">Shibboleth Link</h1>
    </div>

    {#if loading}
      <div class="flex justify-center py-8" aria-label="Loading linking session">
        <span class="size-8 animate-spin rounded-full border-2 border-surface-150 border-t-primary"></span>
      </div>
    {:else if error}
      <ErrorPanel message={error} />
    {/if}

    {#if showLinkInstructions}
      <div class="panel text-left">
        <p class="font-bold">Need a server link?</p>
        <p class="mt-2 text-gray-300">Use <code>/link</code> in the Discord server you are trying to link in, then open the link that Shibboleth Link sends there.</p>
      </div>
    {/if}

    {#if status}
      <div class="flex flex-col gap-2">
        <p class="text-lg">Link accounts to receive roles for the below Discord server!</p>
        <div class="panel w-full">
          <div class="flex flex-row items-center gap-2">
            {#if status.server.iconUrl}
              <img class="size-10 shrink-0 grow-0 select-none rounded-full bg-gray-300 object-cover" src={status.server.iconUrl} alt="" draggable="false" />
            {:else}
              <span class="flex size-10 shrink-0 grow-0 select-none rounded-full bg-gray-300"></span>
            {/if}
            <div class="flex flex-col">
              <p class="font-bold">{status.server.name}</p>
              <p class="font-mono text-sm text-gray-400">{status.server.guildId}</p>
            </div>
          </div>
          <hr class="my-2 border-1 border-surface-150" />
          <span class="flex flex-col gap-1 text-sm">
            {#if status.server.linkingEnabled === false}
              <p class="text-red-200">Linking is currently disabled for this server.</p>
            {:else if status.server.mode === 'link_and_store'}
              <p>Your NetID, UIUC affiliation, and Discord user ID will be stored and made accessible to the owners of this Discord server and the Shibboleth Link operator.</p>
            {:else}
              <p>Your info will not be stored by Shibboleth Link. The owners of this Discord server will be able to see your UIUC affiliation and Discord user ID.</p>
            {/if}
          </span>
        </div>
      </div>

      {#if status.server.linkingEnabled !== false}
        <span class="size-8 select-none items-center self-center rounded-full border-2 border-surface-150 bg-surface-100 text-center font-bold text-gray-400">+</span>

        <div class="flex flex-col items-center gap-2">
          <ProviderCard
            primaryText={status.services.shibboleth.name ?? serviceDefaults.shibboleth.name}
            connected={status.shibboleth.signedIn}
            details={shibbolethDetails()}
            icon={status.services.shibboleth.icon ?? serviceDefaults.shibboleth.icon}
            href={`${apiBase}/api/saml/start?server=${encodeURIComponent(server)}`}
          />
          <ProviderCard
            primaryText={status.services.discord.name ?? serviceDefaults.discord.name}
            connected={status.discord.signedIn}
            details={discordDetails()}
            icon={status.services.discord.icon ?? serviceDefaults.discord.icon}
            href={`${apiBase}/api/discord/start?server=${encodeURIComponent(server)}`}
          />
        </div>

        <p class="mt-4">
          By submitting, you confirm that you have read and agree to the
          <a href={siteConfig.privacyPolicyUrl} target="_blank" rel="noopener">Privacy Policy</a>
          for Shibboleth Link.
        </p>
        <button
          class="w-full select-none rounded-xl bg-primary px-4 py-2 text-center text-lg text-black hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!status.canConfirm || submitting}
          on:click={confirmLink}
        >
          {submitting ? 'Linking...' : 'Submit and Link'}
        </button>
      {/if}
    {/if}
  </div>
</div>
