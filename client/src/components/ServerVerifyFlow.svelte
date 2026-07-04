<script lang="ts">
import ProviderCard from './ProviderCard.svelte';
import ErrorPanel from './ErrorPanel.svelte';
import { codeFor, errorDetails, messageFor } from '@/lib/messages';
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

  type VerifyStatus = {
    flow: {
      id: string;
      expiresAt: number;
      requesterDiscordUserId: string;
      requesterIsOwner: boolean;
      requesterIsAdmin: boolean;
    };
    server?: {
      guildId: string;
      name: string;
      iconUrl?: string;
      verified: boolean;
      verificationExpiresAt?: number;
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
    shibboleth: {
      signedIn: boolean;
      assertions: {
        uid?: string;
        eduPersonAffiliation?: string[];
      };
      active: boolean;
      alum: boolean;
    };
    discord: {
      signedIn: boolean;
      username?: string;
      userId?: string;
    };
    canConfirm: boolean;
    discordMatchesRequester: boolean;
    verification: {
      expiresAt: number;
      satisfied: boolean;
      verifierCount: number;
      activeAdminCount: number;
      ownerVerified: boolean;
    };
  };

  const params = new URLSearchParams(window.location.search);
  const flow = params.get('flow') ?? '';

  let status: VerifyStatus | null = null;
  let loading = true;
  let submitting = false;
  let submitted = false;
  let error = messageFor(params.get('error')) || (params.get('error') ? 'Verification sign-in failed. Please try again.' : '');
  let errorCode = codeFor(params.get('error')) || (params.get('error') ? 'WEB_VERIFY_SUBMIT_FAILED' : '');
  let result = '';

  function dateString(value: number | undefined): string {
    if (!value) return 'unknown';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
  }

  function shibbolethDetails() {
    return status?.services.shibboleth.assertions.map((assertion) => ({
      label: assertion.friendlyName,
      value: status?.shibboleth.assertions[assertion.key],
    })) ?? [];
  }

  function discordDetails() {
    const username = status?.discord.username
      ? status.discord.username.startsWith('@') ? status.discord.username : `@${status.discord.username}`
      : undefined;
    return [
      { label: 'Username', value: username },
      { label: 'Expected user', value: status?.flow.requesterDiscordUserId },
    ];
  }

  function verificationRule(): string {
    return 'One server owner or administrator must verify as an active UIUC member for this server to become a Verified Server.';
  }

  async function loadStatus() {
    if (!flow) {
      error = 'Missing verification flow.';
      loading = false;
      return;
    }

    const response = await fetch(`${apiBase}/api/verify/session?flow=${encodeURIComponent(flow)}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (body.error === 'server_banned') {
        ({ message: error, code: errorCode } = errorDetails('server_banned'));
      } else if (body.error) {
        ({ message: error, code: errorCode } = errorDetails(body.error));
      } else {
        error = response.status === 404 ? 'This verification link is expired or invalid.' : 'Please report this error to the Shibboleth Link operator: Failed to load verification status.';
        errorCode = response.status === 404 ? 'WEB_VERIFY_LINK_INVALID' : 'WEB_VERIFY_STATUS_LOAD_FAILED';
      }
      loading = false;
      return;
    }

    status = await response.json();
    loading = false;

    const connected = params.get('connected');
    const next = params.get('next');
    if (connected && next === 'shib' && !status?.shibboleth.signedIn) {
      window.location.href = `${apiBase}/api/saml/start/${encodeURIComponent(flow)}`;
    }
    if (connected && next === 'discord' && !status?.discord.signedIn) {
      window.location.href = `${apiBase}/api/discord/start/${encodeURIComponent(flow)}`;
    }
  }

  async function confirmVerification() {
    if (!flow) return;
    submitting = true;
    error = '';
    errorCode = '';
    result = '';

    const response = await fetch(`${apiBase}/api/verify/confirm?flow=${encodeURIComponent(flow)}`, {
      method: 'POST',
      credentials: 'include',
    });
    const body = await response.json().catch(() => ({}));
    submitting = false;

    if (!response.ok) {
      if (body.error === 'discord_user_mismatch') {
        error = 'You signed in with a different Discord account than the one that started this verification flow.';
        errorCode = 'WEB_DISCORD_USER_MISMATCH';
      } else if (body.error === 'missing_netid') {
        ({ message: error, code: errorCode } = errorDetails('missing_netid'));
      } else if (body.error === 'server_banned') {
        ({ message: error, code: errorCode } = errorDetails('server_banned'));
      } else if (body.error === 'user_banned') {
        ({ message: error, code: errorCode } = errorDetails('user_banned'));
      } else if (body.error === 'netid_banned') {
        ({ message: error, code: errorCode } = errorDetails('netid_banned'));
      } else if (body.error === 'verification_permission_lost') {
        ({ message: error, code: errorCode } = errorDetails('verification_permission_lost'));
      } else {
        error = 'Verification could not be submitted. Please start a new /verify-self flow.';
        errorCode = 'WEB_VERIFY_SUBMIT_FAILED';
      }
      return;
    }

    result = body.satisfied
      ? `Server verification complete through ${dateString(body.expiresAt)}.`
      : 'Your verification was recorded. Additional eligible admins still need to verify this server.';
    submitted = true;
  }

  loadStatus();
</script>

<div class="container px-4">
  <div class="mx-auto flex max-w-lg flex-col gap-4 pt-8">
    <div class="text-center font-bold">
      <h1 class="text-4xl">Server Verification</h1>
      <p class="mt-2 text-sm font-normal text-gray-400">Verify Discord server administration and UIUC affiliation.</p>
    </div>

    {#if loading}
      <div class="flex justify-center py-8" aria-label="Loading verification session">
        <span class="size-8 animate-spin rounded-full border-2 border-surface-150 border-t-primary"></span>
      </div>
    {:else if error}
      <ErrorPanel message={error} />
    {/if}

    {#if result}
      <div class="panel border-primary bg-green-950/30 text-primary">{result}</div>
    {/if}

    {#if status}
      <div class="panel flex flex-col gap-3">
        <div class="flex flex-row items-center gap-2">
          {#if status.server?.iconUrl}
            <img class="size-10 shrink-0 grow-0 select-none rounded-full bg-gray-300 object-cover" src={status.server.iconUrl} alt="" draggable="false" />
          {:else}
            <span class="flex size-10 shrink-0 grow-0 select-none rounded-full bg-gray-300"></span>
          {/if}
          <div class="flex flex-col">
            <p class="font-bold">{status.server?.name ?? 'Discord server'}</p>
            <p class="font-mono text-sm text-gray-400">{status.server?.guildId}</p>
          </div>
        </div>
        <hr class="border-1 border-surface-150" />
        <p class="text-sm text-gray-300">{verificationRule()}</p>
        <p class="text-sm text-gray-400">Active UIUC member means student and not alum, or staff.</p>
        <p class="text-sm text-gray-400">This policy helps ensure a Verified Server has current UIUC-affiliated administrative control.</p>
        <p class="text-sm text-gray-400">This verification would expire on {dateString(status.verification.expiresAt)}.</p>
      </div>

      <span class="size-8 select-none items-center self-center rounded-full border-2 border-surface-150 bg-surface-100 text-center font-bold text-gray-400">+</span>

      <div class="flex flex-col items-center gap-2">
        <ProviderCard
          primaryText={status.services.shibboleth.name ?? serviceDefaults.shibboleth.name}
          connected={status.shibboleth.signedIn}
          details={shibbolethDetails()}
          icon={status.services.shibboleth.icon ?? serviceDefaults.shibboleth.icon}
          href={`${apiBase}/api/saml/start/${encodeURIComponent(flow)}`}
        />
        {#if status.shibboleth.signedIn && !status.shibboleth.active}
          <div class="panel w-full border-yellow-900 bg-yellow-950/40 text-sm text-yellow-100">
            This UIUC login is not currently considered active for server verification. Active means student and not alum, or staff.
          </div>
        {/if}
        <ProviderCard
          primaryText={status.services.discord.name ?? serviceDefaults.discord.name}
          connected={status.discord.signedIn && status.discordMatchesRequester}
          details={discordDetails()}
          icon={status.services.discord.icon ?? serviceDefaults.discord.icon}
          href={`${apiBase}/api/discord/start/${encodeURIComponent(flow)}`}
        />
        {#if status.discord.signedIn && !status.discordMatchesRequester}
          <div class="error-panel w-full text-sm">
            This browser is signed in as a different Discord user. Start a new verification flow from the correct account.
          </div>
        {/if}
      </div>

      <div class="panel flex flex-col gap-2 text-sm text-gray-300">
        <p>Current verification progress:</p>
        <p>Owner verifier recorded: {status.verification.ownerVerified ? 'yes' : 'no'}</p>
        <p>Eligible admin verifiers recorded: {status.verification.activeAdminCount}</p>
        <p>Policy satisfied: {status.verification.satisfied ? 'yes' : 'no'}</p>
      </div>

      <p class="mt-2">
        By submitting, you confirm that you have read and agree to the
        <a href={siteConfig.privacyPolicyUrl} target="_blank" rel="noopener">Privacy Policy</a>
        for Shibboleth Link.
      </p>
      <button
        class="w-full select-none rounded-xl bg-primary px-4 py-2 text-center text-lg text-black hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!status.canConfirm || submitting || submitted}
        on:click={confirmVerification}
      >
        {submitting ? 'Submitting...' : submitted ? 'Verification Submitted' : 'Submit Server Verification'}
      </button>
    {/if}
  </div>
</div>
