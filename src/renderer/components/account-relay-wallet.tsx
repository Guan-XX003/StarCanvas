import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeDollarSign, Clock3, Copy, Eye, ExternalLink, KeyRound, Link2, ReceiptText, RefreshCw, RotateCw, WalletCards } from "lucide-react";
import {
  confirmRelayLink,
  getAccountState,
  getRechargeStore,
  listRelayUsageRecords,
  listWalletTransactions,
  redeemWalletCode,
  refreshRelayAccount,
  refreshWallet,
  regenerateRelayKey,
  revealRelayKey,
  sendRelayKeyCode,
  sendRelayLinkCode,
  verifyLegacyRelayAccount,
  verifyLegacyRelayMfa,
  accountIdentityScopeKey,
} from "../lib/account";
import { wanjuanAccountRecordRequestIsCurrent, wanjuanAccountRecordsPage, wanjuanBuildAccountRecordTimeRange, wanjuanMergeAccountRecordPages } from "../lib/account-records";

type RecordItem = Record<string, any>;

const money = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : `¥0.00`;
};

const dateTime = (value: unknown) => {
  const date = new Date(String(value || ``));
  return Number.isNaN(date.getTime()) ? `--` : date.toLocaleString();
};

export function AccountRelayWallet({ account, showToast }: { account: ReturnType<typeof getAccountState>; showToast: (message: string) => void }) {
  const [uiLanguage, setUiLanguage] = useState(() => (globalThis as any).wanjuanI18nRuntime?.getLanguage?.() || `zh-CN`);
  const [busy, setBusy] = useState(``);
  const [mode, setMode] = useState<`` | `reveal` | `regenerate` | `link`>(``);
  const [verificationCode, setVerificationCode] = useState(``);
  const [linkIdentifier, setLinkIdentifier] = useState(``);
  const [legacyPassword, setLegacyPassword] = useState(``);
  const [legacyMfaCode, setLegacyMfaCode] = useState(``);
  const [legacyChallenge, setLegacyChallenge] = useState(``);
  const [linkStep, setLinkStep] = useState<`credentials` | `mfa` | `email`>(`credentials`);
  const [revealedKey, setRevealedKey] = useState(``);
  const [redeemCode, setRedeemCode] = useState(``);
  const [storeStatus, setStoreStatus] = useState<`checking` | `available` | `unavailable` | `error`>(`checking`);
  const [tab, setTab] = useState<`usage` | `wallet`>(`usage`);
  const [usageRecords, setUsageRecords] = useState<RecordItem[]>([]);
  const [walletRecords, setWalletRecords] = useState<RecordItem[]>([]);
  const [recordFilters, setRecordFilters] = useState({ model: ``, status: ``, fromDate: ``, toDate: `` });
  const [recordCursor, setRecordCursor] = useState(``);
  const [recordHasMore, setRecordHasMore] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const recordRequestRef = useRef(0);
  const storeRequestRef = useRef(0);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkIdempotencyKey = useRef(``);
  const accountScope = accountIdentityScopeKey(account);
  const accountScopeRef = useRef(accountScope);
  accountScopeRef.current = accountScope;
  const relayUiEnabled = account.featureFlags?.relayManagedConfig !== false;
  const walletUiEnabled = account.featureFlags?.relayWalletUi !== false && account.wallet?.enabled !== false;
  const redeemUiEnabled = walletUiEnabled && account.featureFlags?.relayRedeem !== false && account.wallet?.redeemEnabled !== false;
  const legacyLinkEnabled = account.featureFlags?.relayLegacyLink === true;
  const relayActive = account.relay?.status === `active` && account.relay?.managed === true;
  const t = (text: string) => (globalThis as any).wanjuanI18nRuntime?.t?.(text, uiLanguage) || text;

  useEffect(() => {
    const runtime = (globalThis as any).wanjuanI18nRuntime;
    if (!runtime?.subscribe) return;
    return runtime.subscribe(() => setUiLanguage(runtime.getLanguage?.() || `zh-CN`));
  }, []);

  useEffect(() => {
    const root = document.querySelector(`.wanjuan-account-settings-page`);
    (globalThis as any).wanjuanI18nRuntime?.translateTree?.(root);
  }, [uiLanguage]);

  const resetLinkFlow = () => {
    setMode(``);
    setVerificationCode(``);
    setLinkIdentifier(``);
    setLegacyPassword(``);
    setLegacyMfaCode(``);
    setLegacyChallenge(``);
    setLinkStep(`credentials`);
    linkIdempotencyKey.current = ``;
  };

  useEffect(() => () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
  }, []);

  useEffect(() => {
    resetLinkFlow();
    setBusy(``);
    setRevealedKey(``);
    setRedeemCode(``);
    setUsageRecords([]);
    setWalletRecords([]);
    setRecordCursor(``);
    setRecordHasMore(false);
    setRecordsLoading(false);
    recordRequestRef.current += 1;
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = null;
  }, [accountScope]);

  const checkRechargeStore = async () => {
    const requestScope = accountScopeRef.current;
    const requestId = ++storeRequestRef.current;
    setStoreStatus(`checking`);
    const result = await getRechargeStore();
    if (accountScopeRef.current !== requestScope || storeRequestRef.current !== requestId) return;
    setStoreStatus(!result?.ok ? `error` : result.available === false || !result.url ? `unavailable` : `available`);
  };

  useEffect(() => {
    if (account.authenticated && redeemUiEnabled) void checkRechargeStore();
    else setStoreStatus(`checking`);
    return () => { storeRequestRef.current += 1; };
  }, [accountScope, account.authenticated, redeemUiEnabled]);

  useEffect(() => {
    if (!account.authenticated) return;
    const requestScope = accountScope;
    const requests = [];
    if (relayUiEnabled) requests.push(refreshRelayAccount());
    if (walletUiEnabled) requests.push(refreshWallet());
    Promise.allSettled(requests).then(() => {
      if (accountScopeRef.current !== requestScope) return;
    });
  }, [accountScope, account.authenticated, relayUiEnabled, walletUiEnabled]);

  useEffect(() => {
    if (!relayUiEnabled && walletUiEnabled) setTab(`wallet`);
    else if (relayUiEnabled && !walletUiEnabled) setTab(`usage`);
  }, [relayUiEnabled, walletUiEnabled]);

  useEffect(() => {
    if (!account.authenticated) return;
    if ((tab === `usage` && !relayUiEnabled) || (tab === `wallet` && !walletUiEnabled)) return;
    const requestScope = accountScope;
    const requestId = ++recordRequestRef.current;
    let cancelled = false;
    setRecordsLoading(true);
    setRecordCursor(``);
    setRecordHasMore(false);
    let timeRange: Record<string, string>;
    try {
      timeRange = wanjuanBuildAccountRecordTimeRange(recordFilters.fromDate, recordFilters.toDate);
    } catch (error) {
      setRecordsLoading(false);
      if (tab === `usage`) setUsageRecords([]); else setWalletRecords([]);
      showToast(String((error as any)?.message || error));
      return;
    }
    const request = tab === `usage`
      ? listRelayUsageRecords({ model: recordFilters.model, status: recordFilters.status, ...timeRange, limit: 30 })
      : listWalletTransactions({ ...timeRange, limit: 30 });
    request.then((result) => {
      if (!wanjuanAccountRecordRequestIsCurrent({ cancelled, requestScope, currentScope: accountScopeRef.current, requestId, currentRequestId: recordRequestRef.current })) return;
      if (!result?.ok) throw new Error(result?.error || `记录加载失败`);
      const page = wanjuanAccountRecordsPage(result);
      if (tab === `usage`) setUsageRecords(page.items);
      else setWalletRecords(page.items);
      setRecordCursor(page.nextCursor);
      setRecordHasMore(page.hasMore);
    }).catch((error) => {
      if (!cancelled && accountScopeRef.current === requestScope && recordRequestRef.current === requestId) showToast(String(error?.message || error));
    }).finally(() => {
      if (!cancelled && accountScopeRef.current === requestScope && recordRequestRef.current === requestId) setRecordsLoading(false);
    });
    return () => { cancelled = true; };
  }, [accountScope, account.authenticated, tab, recordFilters, relayUiEnabled, walletUiEnabled]);

  const loadMoreRecords = async () => {
    if (!recordCursor || recordsLoading) return;
    const requestScope = accountScopeRef.current;
    const requestId = ++recordRequestRef.current;
    setRecordsLoading(true);
    try {
      const timeRange = wanjuanBuildAccountRecordTimeRange(recordFilters.fromDate, recordFilters.toDate);
      const result = tab === `usage`
        ? await listRelayUsageRecords({ model: recordFilters.model, status: recordFilters.status, ...timeRange, limit: 30, cursor: recordCursor })
        : await listWalletTransactions({ ...timeRange, limit: 30, cursor: recordCursor });
      if (accountScopeRef.current !== requestScope || recordRequestRef.current !== requestId) return;
      if (!result?.ok) throw new Error(result?.error || `记录加载失败`);
      const page = wanjuanAccountRecordsPage(result);
      if (tab === `usage`) setUsageRecords((current) => wanjuanMergeAccountRecordPages(current, page.items));
      else setWalletRecords((current) => wanjuanMergeAccountRecordPages(current, page.items));
      setRecordCursor(page.nextCursor);
      setRecordHasMore(page.hasMore);
    } catch (error) {
      if (accountScopeRef.current === requestScope && recordRequestRef.current === requestId) showToast(String((error as any)?.message || error));
    } finally {
      if (accountScopeRef.current === requestScope && recordRequestRef.current === requestId) setRecordsLoading(false);
    }
  };

  const updateRecordFilter = (key: keyof typeof recordFilters, value: string) => {
    setRecordFilters((current) => ({ ...current, [key]: value }));
  };

  const clearRecordFilters = () => setRecordFilters({ model: ``, status: ``, fromDate: ``, toDate: `` });

  const records = tab === `usage` ? usageRecords : walletRecords;
  const recordStatusLabel = (item: RecordItem) => {
    if (item.statusLabel) return String(item.statusLabel);
    const status = String(item.status || item.typeLabel || ``);
    return t(({ pending: `处理中`, succeeded: `成功`, failed: `失败`, refunded: `已退款` } as Record<string, string>)[status] || status);
  };
  const statusText = useMemo(() => ({
    active: `已开通`, pending: `正在开通`, retrying: `正在重试`, suspended: `已暂停`, failed: `开通失败`, inactive: `未开通`,
  }[String(account.relay?.status || `inactive`)] || `未开通`), [account.relay?.status]);
  const relayStatusDetail = useMemo(() => ({
    active: `已自动启用`,
    pending: `正在创建账号与 Key`,
    retrying: `服务暂时不可用，后台重试中`,
    suspended: `账号已暂停，模型调用已停用`,
    failed: `自动开通失败，请稍后刷新或联系客服`,
    inactive: account.featureFlags?.relayAutoProvision === false ? `自动开户暂未开放` : `等待服务开通`,
  }[String(account.relay?.status || `inactive`)] || `等待服务开通`), [account.relay?.status, account.featureFlags?.relayAutoProvision]);

  const beginKeyAction = async (nextMode: `reveal` | `regenerate`) => {
    const requestScope = accountScopeRef.current;
    setBusy(`send-code`);
    const result = await sendRelayKeyCode(nextMode);
    if (accountScopeRef.current !== requestScope) return;
    setBusy(``);
    if (!result?.ok) return showToast(result?.error || `验证码发送失败`);
    setVerificationCode(``);
    setMode(nextMode);
    showToast(`验证码已发送`);
  };

  const submitKeyAction = async () => {
    const requestScope = accountScopeRef.current;
    setBusy(mode);
    const result = mode === `regenerate` ? await regenerateRelayKey(verificationCode) : await revealRelayKey(verificationCode);
    if (accountScopeRef.current !== requestScope) return;
    setBusy(``);
    if (!result?.ok) return showToast(result?.error || `验证失败`);
    const key = String(result.key || ``);
    if (key) {
      setRevealedKey(key);
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => setRevealedKey(``), 60_000);
    }
    setMode(``);
    setVerificationCode(``);
    showToast(mode === `regenerate` ? `新 Key 已生效，旧 Key 已失效` : `Key 将在60秒后自动隐藏`);
  };

  const copyKey = async () => {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    showToast(`Key 已复制`);
  };

  const openRechargeStore = async () => {
    const requestScope = accountScopeRef.current;
    setBusy(`store`);
    const result = await getRechargeStore();
    if (accountScopeRef.current !== requestScope) return;
    setBusy(``);
    if (!result?.ok) { setStoreStatus(`error`); return showToast(t(`充值状态暂时无法获取`)); }
    if (result.available === false || !result.url) { setStoreStatus(`unavailable`); return; }
    const opened = await (window as any).wanjuanDesktop?.openExternal?.(result.url);
    if (opened?.ok === false) showToast(opened.error || `无法打开充值商店`);
  };

  const redeem = async () => {
    if (!redeemCode.trim()) return;
    const requestScope = accountScopeRef.current;
    setBusy(`redeem`);
    const result = await redeemWalletCode(redeemCode.trim());
    if (accountScopeRef.current !== requestScope) return;
    setBusy(``);
    if (!result?.ok) return showToast(result?.error || `兑换失败`);
    setRedeemCode(``);
    await refreshWallet();
    showToast(`充值码兑换成功`);
  };

  const requestLinkCode = async () => {
    if (!account.user?.email) return showToast(`当前账号缺少已验证邮箱，无法绑定原极鑫账号`);
    const requestScope = accountScopeRef.current;
    setBusy(`link-code`);
    const result = await sendRelayLinkCode();
    if (accountScopeRef.current !== requestScope) return;
    setBusy(``);
    if (!result?.ok) return showToast(result?.error || `验证码发送失败`);
    showToast(`验证码已发送到当前账号邮箱`);
  };

  const verifyLegacy = async () => {
    const requestScope = accountScopeRef.current;
    setBusy(`link-legacy`);
    const result = await verifyLegacyRelayAccount(linkIdentifier, legacyPassword);
    if (accountScopeRef.current !== requestScope) return;
    setBusy(``);
    if (!result?.ok || !result.challenge) return showToast(result?.error || `旧账号验证失败`);
    if (![`verified`, `mfa_required`].includes(String(result.status || ``))) return showToast(`旧账号验证状态无效，请重新验证`);
    setLegacyPassword(``);
    setLegacyChallenge(result.challenge);
    setLinkStep(result.status === `mfa_required` ? `mfa` : `email`);
    if (result.status !== `mfa_required`) await requestLinkCode();
  };

  const verifyLegacyMfa = async () => {
    const requestScope = accountScopeRef.current;
    setBusy(`link-mfa`);
    const result = await verifyLegacyRelayMfa(legacyChallenge, legacyMfaCode);
    if (accountScopeRef.current !== requestScope) return;
    setBusy(``);
    if (!result?.ok || result.status !== `verified` || !result.challenge) return showToast(result?.error || `MFA 验证失败`);
    setLegacyMfaCode(``);
    setLegacyChallenge(result.challenge);
    setLinkStep(`email`);
    await requestLinkCode();
  };

  const linkAccount = async () => {
    const requestScope = accountScopeRef.current;
    setBusy(`link`);
    if (!linkIdempotencyKey.current) {
      linkIdempotencyKey.current = `starcanvas-relay-link-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    }
    const result = await confirmRelayLink(verificationCode, legacyChallenge, linkIdempotencyKey.current);
    if (accountScopeRef.current !== requestScope) return;
    setBusy(``);
    if (result?.status === `review` || result?.code === `LINK_REVIEW_REQUIRED` || result?.relay?.status === `review`) {
      resetLinkFlow();
      showToast(`账号绑定需要人工审核，原余额和 Key 保持不变`);
      return;
    }
    if (!result?.ok) return showToast(result?.error || `账号绑定失败`);
    resetLinkFlow();
    await Promise.allSettled([refreshRelayAccount(), refreshWallet()]);
    showToast(`原极鑫账号已绑定`);
  };

  return <>
    {relayUiEnabled && <section className="wanjuan-account-settings-band">
      <div className="wanjuan-account-band-heading with-action">
        <div className="wanjuan-account-band-title"><KeyRound size={18} /><div><strong>极鑫托管服务</strong><span>登录后自动开通，无需手动配置接口和 Key</span></div></div>
        <span className={`wanjuan-account-pill ${relayActive ? `is-success` : [`failed`, `suspended`].includes(String(account.relay?.status)) ? `is-warning` : ``}`}>{statusText}</span>
      </div>
      <div className="wanjuan-account-managed-relay-row">
        <div><span>托管配置</span><strong>{relayStatusDetail}</strong></div>
        <div><span>接入 Key</span><strong>{revealedKey || account.relay?.keyMasked || `--`}</strong></div>
      </div>
      <div className="wanjuan-account-action-row">
        {revealedKey && <button className="wanjuan-account-outline-button" type="button" onClick={copyKey}><Copy size={14} />复制 Key</button>}
        <button className="wanjuan-account-outline-button" type="button" disabled={!relayActive || !!busy} onClick={() => beginKeyAction(`reveal`)}><Eye size={14} />查看 Key</button>
        <button className="wanjuan-account-outline-button" type="button" disabled={!relayActive || !!busy} onClick={() => beginKeyAction(`regenerate`)}><RotateCw size={14} />重新生成</button>
        {legacyLinkEnabled && <button className="wanjuan-account-outline-button" type="button" disabled={!account.authenticated || !account.user?.email || !!busy} onClick={() => { resetLinkFlow(); setMode(`link`); }}><Link2 size={14} />绑定原极鑫账号</button>}
        <button className="wanjuan-account-icon-button" type="button" disabled={!account.authenticated || !!busy} onClick={() => refreshRelayAccount()} title="刷新极鑫账号"><RefreshCw size={14} /></button>
      </div>
      {(mode === `reveal` || mode === `regenerate`) && <div className="wanjuan-account-inline-form">
        <label><span>验证码</span><input autoFocus inputMode="numeric" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} placeholder="输入验证码" /></label>
        <button type="button" className="wanjuan-account-primary-inline" disabled={!verificationCode.trim() || !!busy} onClick={submitKeyAction}>{busy ? `正在验证` : mode === `regenerate` ? `确认重新生成` : `查看60秒`}</button>
        <button type="button" className="wanjuan-account-outline-button" onClick={() => { setMode(``); linkIdempotencyKey.current = ``; }}>取消</button>
      </div>}
      {mode === `link` && <div className="wanjuan-account-inline-form is-link-form">
        {linkStep === `credentials` && <>
          <label><span>原极鑫账号</span><input value={linkIdentifier} onChange={(event) => setLinkIdentifier(event.target.value)} placeholder="旧邮箱或用户名" autoComplete="username" /></label>
          <label><span>原极鑫密码</span><input type="password" value={legacyPassword} onChange={(event) => setLegacyPassword(event.target.value)} autoComplete="current-password" placeholder="仅用于本次身份验证" /></label>
          <button type="button" className="wanjuan-account-primary-inline" disabled={!linkIdentifier.trim() || !legacyPassword || !!busy} onClick={verifyLegacy}>验证旧账号</button>
        </>}
        {linkStep === `mfa` && <>
          <label><span>MFA 验证码</span><input inputMode="numeric" value={legacyMfaCode} onChange={(event) => setLegacyMfaCode(event.target.value)} placeholder="输入旧账号 MFA 验证码" autoComplete="one-time-code" /></label>
          <button type="button" className="wanjuan-account-primary-inline" disabled={!legacyMfaCode.trim() || !!busy} onClick={verifyLegacyMfa}>验证 MFA</button>
        </>}
        {linkStep === `email` && <>
          <label><span>当前账号邮箱</span><input value={account.user?.email || ``} readOnly /></label>
          <button type="button" className="wanjuan-account-outline-button" disabled={!!busy} onClick={requestLinkCode}>发送验证码</button>
          <label><span>邮箱验证码</span><input inputMode="numeric" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} placeholder="输入当前邮箱验证码" autoComplete="one-time-code" /></label>
          <button type="button" className="wanjuan-account-primary-inline" disabled={!verificationCode.trim() || !legacyChallenge || !!busy} onClick={linkAccount}>确认绑定</button>
        </>}
        <button type="button" className="wanjuan-account-outline-button" onClick={resetLinkFlow}>取消</button>
      </div>}
      <p className="wanjuan-account-band-note">托管 Key 由系统安全存储加密，不会写入画布项目或导出包。已有手动 API 配置不会被覆盖。</p>
    </section>}

    {walletUiEnabled && <section className="wanjuan-account-settings-band">
      <div className="wanjuan-account-band-heading with-action">
        <div className="wanjuan-account-band-title"><WalletCards size={18} /><div><strong>模型余额</strong><span>充值余额、体验金与任务预占分开记账</span></div></div>
        {redeemUiEnabled && storeStatus === `available` && <button type="button" className="wanjuan-account-primary-inline" disabled={!account.authenticated || !!busy} onClick={openRechargeStore}><ExternalLink size={14} />{t(busy === `store` ? `正在打开` : `去充值`)}</button>}
        {redeemUiEnabled && storeStatus === `unavailable` && <span>{t(`充值暂未开放`)}</span>}
        {redeemUiEnabled && storeStatus === `checking` && <span>{t(`正在查询充值状态`)}</span>}
        {redeemUiEnabled && storeStatus === `error` && <button type="button" className="wanjuan-account-outline-button" onClick={() => void checkRechargeStore()}>{t(`重新查询充值状态`)}</button>}
      </div>
      <div className="wanjuan-account-wallet-metrics">
        <div className="is-primary"><span>可用余额</span><strong>{money(account.wallet?.availableAmount)}</strong></div>
        <div><span>充值余额</span><strong>{money(account.wallet?.cashAmount)}</strong></div>
        <div><span>体验金</span><strong>{money(account.wallet?.promoAmount)}</strong>{account.wallet?.promoExpiresAt && <small><span>有效期至</span> {new Date(account.wallet.promoExpiresAt).toLocaleDateString()}</small>}</div>
        <div><span>任务预占</span><strong>{money(account.wallet?.reservedAmount)}</strong></div>
      </div>
      {redeemUiEnabled && <div className="wanjuan-account-redeem-row">
        <BadgeDollarSign size={17} />
        <input value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} placeholder="粘贴充值码" />
        <button type="button" className="wanjuan-account-primary-inline" disabled={!redeemCode.trim() || !!busy} onClick={redeem}>{busy === `redeem` ? `正在兑换` : `兑换`}</button>
      </div>}
    </section>}

    {(relayUiEnabled || walletUiEnabled) && <section className="wanjuan-account-settings-band">
      <div className="wanjuan-account-band-heading"><ReceiptText size={18} /><div><strong>账单与使用记录</strong><span>仅显示计费信息，不保存提示词、媒体地址和 Key</span></div></div>
      <div className="wanjuan-account-record-tabs">
        {relayUiEnabled && <button type="button" className={tab === `usage` ? `is-active` : ``} onClick={() => setTab(`usage`)}>模型使用</button>}
        {walletUiEnabled && <button type="button" className={tab === `wallet` ? `is-active` : ``} onClick={() => setTab(`wallet`)}>资金明细</button>}
      </div>
      <div className="wanjuan-account-record-filters">
        {tab === `usage` && <>
          <label><span>{t(`模型`)}</span><input value={recordFilters.model} onChange={(event) => updateRecordFilter(`model`, event.target.value)} placeholder={t(`全部模型`)} /></label>
          <label><span>{t(`状态`)}</span><select value={recordFilters.status} onChange={(event) => updateRecordFilter(`status`, event.target.value)}><option value="">{t(`全部状态`)}</option><option value="pending">{t(`处理中`)}</option><option value="succeeded">{t(`成功`)}</option><option value="failed">{t(`失败`)}</option><option value="refunded">{t(`已退款`)}</option></select></label>
        </>}
        <label><span>{t(`开始日期`)}</span><input type="date" max={recordFilters.toDate || undefined} value={recordFilters.fromDate} onChange={(event) => updateRecordFilter(`fromDate`, event.target.value)} /></label>
        <label><span>{t(`结束日期`)}</span><input type="date" min={recordFilters.fromDate || undefined} value={recordFilters.toDate} onChange={(event) => updateRecordFilter(`toDate`, event.target.value)} /></label>
        <button type="button" className="wanjuan-account-outline-button" onClick={clearRecordFilters}>{t(`清除筛选`)}</button>
      </div>
      <div className="wanjuan-account-record-list">
        {recordsLoading && records.length === 0 ? <div className="wanjuan-account-record-empty"><RefreshCw className="is-spinning" size={16} />正在加载</div> : records.length === 0 ? <div className="wanjuan-account-record-empty"><Clock3 size={16} />暂无记录</div> : records.map((item, index) => <div className="wanjuan-account-record" key={String(item.id || item.ledgerId || index)}>
          <div><strong>{String(item.modelName || item.model || item.typeLabel || item.type || `--`)}</strong><span>{dateTime(item.createdAt || item.created_at)}</span>{tab === `usage` && item.source === `legacy` ? <span title={t(`导入的旧消费记录，不会再次扣款`)}>{t(`历史记录`)}{item.priceKnown === false ? ` · ${t(`原价信息未知`)}` : ``}</span> : null}</div>
          <div><strong>{money(item.actualAmount ?? item.chargedAmount ?? item.amount ?? item.amountDelta ?? item.quotaAmount)}</strong><span>{recordStatusLabel(item)}</span></div>
        </div>)}
      </div>
      {recordHasMore && <button type="button" className="wanjuan-account-record-more wanjuan-account-outline-button" disabled={recordsLoading} onClick={loadMoreRecords}>{recordsLoading ? t(`正在加载`) : t(`加载更多`)}</button>}
    </section>}
  </>;
}
