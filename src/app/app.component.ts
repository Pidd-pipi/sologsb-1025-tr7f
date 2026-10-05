import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  NbAlertModule,
  NbBadgeModule,
  NbButtonModule,
  NbCardModule,
  NbCheckboxModule,
  NbIconModule,
  NbInputModule,
  NbLayoutModule,
  NbOptionModule,
  NbSelectModule,
  NbTabsetModule,
  NbToastrModule,
  NbToastrService
} from '@nebular/theme';
import {
  ConflictItem,
  Discussion,
  LanguageVersion,
  LEGACY_STORAGE_KEY,
  LockAction,
  MAX_LANGUAGES,
  MergeState,
  NoticeDraft,
  OfflineEntry,
  PACKAGE_INDEX_KEY,
  PackageBaseline,
  ReleasePackage,
  ReviewStatus,
  RoleReview,
  VersionSnapshot,
  clone,
  contentSignature,
  deepEqual,
  deriveLocks,
  mergeLocks,
  mergeNotices,
  migrateNotice,
  offlineKey,
  packageKey,
  uid
} from './release-package';

type WorkspaceView = 'compose' | 'checks' | 'review' | 'versions' | 'sync';
type CheckLevel = 'error' | 'warning' | 'info';

interface CheckResult {
  id: string;
  category: string;
  level: CheckLevel;
  title: string;
  detail: string;
}

interface DiffRow {
  left: string;
  right: string;
  kind: 'same' | 'changed' | 'added' | 'removed';
}

interface NoticeTemplate {
  id: string;
  name: string;
  description: string;
  eventType: string;
  severity: string;
  scope: string;
  channels: string[];
  title: Record<string, string>;
  body: Record<string, string>;
}

function initialDraft(): NoticeDraft {
  const first: VersionSnapshot = {
    id: 'version-1-0-0',
    label: '首次发布稿',
    createdAt: '2026-09-23T08:10:00+08:00',
    version: '1.0.0',
    title: '台风“海燕”橙色预警通知',
    scope: '滨海新区沿海街道',
    severity: '橙色',
    eventAt: '2026-09-23T07:30:00+08:00',
    effectiveAt: '2026-09-23T09:00:00+08:00',
    expiresAt: '2026-09-24T08:00:00+08:00',
    channels: ['短信', '广播', '社区大屏'],
    note: '发布范围覆盖滨海新区。',
    emergency: false,
    languages: [
      {
        id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: '台风“海燕”橙色预警通知',
        body: '请滨海新区居民立即停止户外活动。预计今天下午出现强风和暴雨。请远离临时建筑，并关注后续通知。',
        translator: '林晓', reviewed: true
      },
      {
        id: 'en', locale: 'en', name: 'English', title: 'Orange alert for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Strong winds and heavy rain are expected this afternoon. Stay away from temporary structures and monitor further notices.',
        translator: '周晴', reviewed: true
      }
    ]
  };

  const second: VersionSnapshot = {
    ...clone(first),
    id: 'version-1-1-0',
    label: '扩大影响范围',
    createdAt: '2026-09-24T10:35:00+08:00',
    version: '1.1.0',
    title: '台风“海燕”橙色预警及人员转移通知',
    scope: '滨海新区全区，重点为沿海街道',
    note: '增加沿海街道转移要求。',
    languages: [
      {
        ...clone(first.languages[0]),
        id: 'zh-CN',
        title: '台风“海燕”橙色预警及人员转移通知',
        body: '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至就近安置点。预计今天下午出现强风和暴雨。请远离临时建筑，并关注后续通知。'
      } as LanguageVersion,
      {
        ...clone(first.languages[1]),
        id: 'en',
        title: 'Orange alert and evacuation notice for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Residents of coastal subdistricts must move to the nearest shelter before 17:00 today. Strong winds and heavy rain are expected this afternoon. Stay away from temporary structures and monitor further notices.'
      } as LanguageVersion
    ]
  };

  const draft: NoticeDraft = {
    id: 'notice-haiyan-2026',
    title: '台风“海燕”橙色预警及人员转移通知',
    eventType: '台风',
    severity: '橙色',
    scope: '滨海新区全区，重点为沿海街道',
    channels: ['短信', '广播', '社区大屏', '政务新媒体'],
    eventAt: '2026-09-25T07:30',
    effectiveAt: '2026-09-25T09:00',
    expiresAt: '2026-09-26T08:00',
    requiredLocales: ['zh-CN', 'en', 'ja'],
    languages: [
      {
        id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: '台风“海燕”橙色预警及人员转移通知',
        body: '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至就近安置点。预计今天下午出现强风和暴雨。不要停留在临时建筑附近，并持续关注后续通知。',
        translator: '林晓', reviewed: true
      },
      {
        id: 'en', locale: 'en', name: 'English', title: 'Orange alert and evacuation notice for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Residents of coastal subdistricts must move to the nearest shelter before 17:00 today. Strong winds and heavy rain are expected this afternoon. Keep away from temporary buildings and continue to monitor further notices.',
        translator: '周晴', reviewed: true
      },
      {
        id: 'ja', locale: 'ja', name: '日本語', title: '台風「ハイエン」オレンジ警報',
        body: '浜海新区の住民は直ちに屋外活動を中止してください。本日午後、強風と大雨が見込まれます。仮設建物に近づかず、今後の通知を確認してください。',
        translator: '佐藤 明', reviewed: false
      }
    ],
    discussions: [
      {
        id: 'comment-1', languageId: 'zh-CN', sentenceIndex: 1, author: '陈冉', role: '法务审阅',
        text: '建议明确安置点地址由属地另行发送，避免通知被理解为完整点位清单。', createdAt: '2026-09-25T08:16:00+08:00', resolved: false
      }
    ],
    reviews: [
      { role: '编辑', owner: '林晓', status: 'approved', note: '事件要素完整。' },
      { role: '法务', owner: '陈冉', status: 'changes', note: '转移表述需补充依据。' },
      { role: '翻译', owner: '周晴', status: 'pending', note: '等待日文版复核。' },
      { role: '发布人', owner: '值班中心', status: 'pending', note: '' }
    ],
    versions: [first, second],
    status: 'in-review',
    version: '1.2.0-draft',
    emergencyRevision: false,
    updatedAt: new Date().toISOString()
  };
  const signature = contentSignature(draft);
  draft.reviews.forEach((review) => {
    if (review.status === 'approved') review.signature = signature;
  });
  return draft;
}

const TEMPLATES: NoticeTemplate[] = [
  {
    id: 'typhoon', name: '台风人员转移', description: '适用于沿海区域人员转移和停业停课提醒。',
    eventType: '台风', severity: '橙色', scope: '沿海街道', channels: ['短信', '广播', '社区大屏'],
    title: { 'zh-CN': '台风预警及人员转移通知', en: 'Typhoon alert and evacuation notice', ja: '台風警報・避難のお知らせ' },
    body: {
      'zh-CN': '请相关区域居民立即停止户外活动。危险区域人员请按属地安排转移至安全场所。预计将出现强风和暴雨，请远离临时建筑并关注后续通知。',
      en: 'Residents in the affected area should stop outdoor activities immediately. People in high-risk areas must follow local evacuation arrangements. Strong winds and heavy rain are expected. Stay away from temporary structures and monitor further notices.',
      ja: '対象地域の住民は直ちに屋外活動を中止してください。危険地域の方は自治体の避難指示に従ってください。強風と大雨が見込まれます。仮設建物に近づかず、今後の通知を確認してください。'
    }
  },
  {
    id: 'water', name: '供水异常', description: '适用于计划停水和恢复供水通知。',
    eventType: '公共设施', severity: '黄色', scope: '城市供水片区', channels: ['短信', '政务新媒体'],
    title: { 'zh-CN': '计划停水通知', en: 'Planned water service interruption', ja: '断水のお知らせ' },
    body: {
      'zh-CN': '因管网维护，相关区域将于指定时间暂停供水。请提前储水并关闭用水设备。恢复供水后可能出现短时浑浊，请排放后再使用。',
      en: 'Water service will be temporarily suspended for network maintenance. Please store water in advance and close water fixtures. Water may appear cloudy when service resumes; run the tap before use.',
      ja: '管路保守作業のため、対象地域では一時的に断水します。事前に水を確保し、水道設備を閉めてください。復旧後は濁りが生じる場合があるため、しばらく通水してから使用してください。'
    }
  },
  {
    id: 'public-safety', name: '公共安全提醒', description: '适用于大型活动周边临时管控。',
    eventType: '公共安全', severity: '黄色', scope: '活动周边道路', channels: ['广播', '社区大屏', '政务新媒体'],
    title: { 'zh-CN': '大型活动期间临时交通提醒', en: 'Temporary traffic notice during major event', ja: '大規模イベント期間中の交通規制' },
    body: {
      'zh-CN': '活动期间部分道路将采取临时管控措施。请服从现场指引，合理规划出行路线，非必要不前往管控区域。',
      en: 'Temporary traffic controls will be in place during the event. Follow on-site directions, plan your route, and avoid restricted areas unless necessary.',
      ja: 'イベント期間中、一部道路で交通規制を行います。現場の案内に従い、移動経路を事前に確認してください。不要な場合は規制区域への立入りを控えてください。'
    }
  }
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NbLayoutModule,
    NbCardModule,
    NbButtonModule,
    NbInputModule,
    NbSelectModule,
    NbOptionModule,
    NbCheckboxModule,
    NbTabsetModule,
    NbIconModule,
    NbBadgeModule,
    NbAlertModule,
    NbToastrModule
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  readonly templates = TEMPLATES;
  readonly eventTypes = ['台风', '暴雨', '地震', '公共卫生', '公共设施', '公共安全'];
  readonly severities = ['蓝色', '黄色', '橙色', '红色'];
  readonly channelOptions = ['短信', '广播', '社区大屏', '政务新媒体', '应急喇叭', '网站'];
  readonly locales = [
    { id: 'zh-CN', name: '简体中文' },
    { id: 'en', name: 'English' },
    { id: 'ja', name: '日本語' },
    { id: 'ko', name: '한국어' },
    { id: 'es', name: 'Español' }
  ];
  readonly bannedTerms = ['大概', '可能吧', '无需恐慌', '绝对不会', '保证安全'];
  readonly glossary = [
    { canonical: '立即', variants: ['马上', '赶紧'] },
    { canonical: '安置点', variants: ['避难所', '庇护所'] },
    { canonical: '持续关注', variants: ['随时留意', '保持观看'] }
  ];
  readonly roles: RoleReview['role'][] = ['编辑', '法务', '翻译', '发布人'];
  readonly maxLanguages = MAX_LANGUAGES;

  draft: NoticeDraft = initialDraft();
  activeView: WorkspaceView = 'compose';
  selectedLanguageId = 'zh-CN';
  selectedSentenceIndex = 0;
  selectedTemplateId = 'typhoon';
  discussionText = '';
  currentRole: RoleReview['role'] = '编辑';
  compareBaseId = '';
  compareTargetId = '';
  lastSavedAt = '';
  history: NoticeDraft[] = [];
  future: NoticeDraft[] = [];

  /** 发布包状态：草稿、语言、角色确认与锁定动作统一在带基线的包内。 */
  packageIds: string[] = [];
  packageId = '';
  revision = 0;
  locks: LockAction[] = [];
  mergeState: MergeState | null = null;
  manualOffline = false;
  browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  newLanguageId = '';
  private baseline: PackageBaseline | null = null;
  private readonly tabId = uid('tab');

  constructor(private readonly toastr: NbToastrService) {}

  ngOnInit(): void {
    this.migrateStorage();
    this.packageIds = this.readIndex();
    if (!this.packageIds.length) {
      localStorage.removeItem(PACKAGE_INDEX_KEY);
      this.migrateStorage();
      this.packageIds = this.readIndex();
    }
    this.packageId = this.packageIds[0] ?? '';
    if (this.packageId) this.loadPackage();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveNow();
      this.toastr.success(this.isOnline && !this.mergeState ? '草稿已写入共享发布包。' : '草稿已保存到本机离线草稿。', '保存成功');
    }
  }

  /** 另一窗口写入发布包时触发：未分叉则快进，已分叉则进入冲突核对。 */
  @HostListener('window:storage', ['$event'])
  handleStorage(event: StorageEvent): void {
    if (!this.packageId || event.key !== packageKey(this.packageId) || !event.newValue) return;
    if (!this.isOnline) return;
    let pkg: ReleasePackage;
    try {
      pkg = JSON.parse(event.newValue) as ReleasePackage;
    } catch {
      return;
    }
    if (this.mergeState) {
      if (pkg.revision === this.mergeState.storedRevision) return;
      this.rebaseMerge(pkg);
      return;
    }
    if (pkg.revision <= this.revision) return;
    if (this.baseline && deepEqual(this.draft, this.baseline.notice)) {
      this.revision = pkg.revision;
      this.baseline = { revision: pkg.revision, notice: clone(pkg.notice), locks: clone(pkg.locks) };
      this.draft = clone(pkg.notice);
      this.locks = clone(pkg.locks);
      this.clearOffline();
      this.ensureSelection();
      this.resetCompare();
      this.touchSaved();
      this.toastr.info(`已同步另一窗口的更新（基线 r${pkg.revision}）。`, '发布包已更新');
    } else {
      this.enterConflict(pkg);
    }
  }

  @HostListener('window:online')
  handleOnline(): void {
    this.browserOnline = true;
    if (this.isOnline) this.flushOffline();
  }

  @HostListener('window:offline')
  handleOffline(): void {
    this.browserOnline = false;
  }

  get isOnline(): boolean {
    return this.browserOnline && !this.manualOffline;
  }

  get syncLabel(): string {
    if (this.mergeState) return `冲突待处理 ${this.pendingConflicts.length} 项 · 基线 r${this.mergeState.baseRevision}`;
    if (!this.isOnline) return `离线 · 草稿保存在本机 · 基线 r${this.revision}`;
    return `已同步 · 发布包基线 r${this.revision} · ${this.lastSavedAt}`;
  }

  get pendingConflicts(): ConflictItem[] {
    return this.mergeState?.conflicts.filter((conflict) => !conflict.resolution) ?? [];
  }

  get selectedLanguage(): LanguageVersion {
    return (
      this.draft.languages.find((language) => language.id === this.selectedLanguageId) ??
      this.draft.languages[0] ?? { id: '', locale: '', name: '—', title: '', body: '', translator: '', reviewed: false }
    );
  }

  get availableLocales(): Array<{ id: string; name: string }> {
    return this.locales.filter((locale) => !this.draft.languages.some((language) => language.id === locale.id));
  }

  get selectedTemplateDescription(): string {
    return this.templates.find((template) => template.id === this.selectedTemplateId)?.description ?? '请选择一个模板';
  }

  get unresolvedDiscussionCount(): number {
    return this.draft.discussions.filter((discussion) => !discussion.resolved).length;
  }

  get currentSentences(): string[] {
    return this.splitSentences(this.selectedLanguage?.body ?? '');
  }

  get activeDiscussions(): Discussion[] {
    return this.draft.discussions.filter((discussion) => discussion.languageId === this.selectedLanguageId);
  }

  get checks(): CheckResult[] {
    const checks: CheckResult[] = [];
    const requiredMeta: Array<[string, string]> = [
      ['标题', this.draft.title], ['事件类型', this.draft.eventType], ['严重程度', this.draft.severity],
      ['影响范围', this.draft.scope], ['事件时间', this.draft.eventAt], ['生效时间', this.draft.effectiveAt],
      ['失效时间', this.draft.expiresAt]
    ];
    requiredMeta.filter(([, value]) => !value).forEach(([label]) => checks.push({
      id: `meta-${label}`, category: '必填信息', level: 'error', title: `缺少${label}`,
      detail: `请补全通知的${label}后再提交发布。`
    }));
    if (!this.draft.channels.length) checks.push({
      id: 'channels', category: '发布渠道', level: 'error', title: '未选择目标渠道', detail: '至少选择一个目标发布渠道。'
    });

    this.draft.requiredLocales.forEach((locale) => {
      if (!this.draft.languages.some((language) => language.id === locale)) {
        const name = this.locales.find((item) => item.id === locale)?.name ?? locale;
        checks.push({
          id: `missing-${locale}`, category: '语言完整性', level: 'error', title: `${name}版本缺失`,
          detail: '该语言属于本次发布的必需语言，请添加并完成翻译。'
        });
      }
    });
    if (this.draft.languages.length > MAX_LANGUAGES) checks.push({
      id: 'language-cap', category: '语言完整性', level: 'error',
      title: `语言版本超过 ${MAX_LANGUAGES} 个`, detail: '超出发布包含量上限，请移除多余语言版本后再冻结。'
    });

    this.draft.languages.forEach((language) => {
      if (!language.title.trim() || !language.body.trim()) checks.push({
        id: `required-${language.id}`, category: '必填信息', level: 'error', title: `${language.name}内容不完整`,
        detail: '语言版本必须包含标题和正文。'
      });
      if (!language.reviewed) checks.push({
        id: `review-${language.id}`, category: '版本审阅', level: language.id === 'ja' ? 'warning' : 'info',
        title: `${language.name}尚未完成语言复核`, detail: '发布前应确认措辞、术语和本地化表达。'
      });
      const banned = this.bannedTerms.filter((term) => language.body.includes(term));
      if (banned.length) checks.push({
        id: `banned-${language.id}`, category: '禁用词', level: 'error', title: `${language.name}包含禁用词`,
        detail: `请替换：${banned.join('、')}。`
      });
      const inconsistent = this.glossary.filter((entry) => {
        const variantCount = entry.variants.filter((variant) => language.body.includes(variant)).length;
        return variantCount > 0 && (!language.body.includes(entry.canonical) || variantCount > 1);
      });
      if (inconsistent.length) checks.push({
        id: `term-${language.id}`, category: '术语一致性', level: 'warning', title: `${language.name}术语不统一`,
        detail: inconsistent.map((item) => `统一使用“${item.canonical}”，避免“${item.variants.join('、')}”`).join('；')
      });
    });

    const eventAt = this.toTime(this.draft.eventAt);
    const effectiveAt = this.toTime(this.draft.effectiveAt);
    const expiresAt = this.toTime(this.draft.expiresAt);
    if (eventAt && effectiveAt && effectiveAt < eventAt) checks.push({
      id: 'time-effective', category: '时间冲突', level: 'warning', title: '生效时间早于事件时间',
      detail: '请确认这是预防性通知；否则调整事件时间或生效时间。'
    });
    if (effectiveAt && expiresAt && expiresAt <= effectiveAt) checks.push({
      id: 'time-expires', category: '时间冲突', level: 'error', title: '失效时间早于生效时间',
      detail: '通知有效期必须晚于生效时间。'
    });
    const unresolved = this.draft.discussions.filter((discussion) => !discussion.resolved).length;
    if (unresolved) checks.push({
      id: 'discussions', category: '逐句讨论', level: 'warning', title: `${unresolved} 条讨论尚未解决`,
      detail: '冻结发布包前请处理或明确忽略未解决讨论。'
    });
    const stale = this.draft.reviews.filter((review) => this.reviewStale(review));
    if (stale.length) checks.push({
      id: 'reviews-stale', category: '角色确认', level: 'error',
      title: `${stale.length} 项角色确认已失效`,
      detail: `语言正文或角色状态已变化，${stale.map((review) => review.role).join('、')}需要重新确认。`
    });
    return checks;
  }

  get blockingChecks(): CheckResult[] {
    return this.checks.filter((check) => check.level === 'error');
  }

  get warningCount(): number {
    return this.checks.filter((check) => check.level === 'warning').length;
  }

  get isLocked(): boolean {
    return this.draft.status === 'locked';
  }

  /** 内容签名：语言正文或元信息一变即改变，角色确认随之失效重算。 */
  get currentSignature(): string {
    return contentSignature(this.draft);
  }

  reviewStale(review: RoleReview): boolean {
    return review.status === 'approved' && review.signature !== this.currentSignature;
  }

  get staleReviewCount(): number {
    return this.draft.reviews.filter((review) => this.reviewStale(review)).length;
  }

  get allReviewsApproved(): boolean {
    return this.draft.reviews.every((review) => review.status === 'approved' && !this.reviewStale(review));
  }

  get hasIncompleteReviews(): boolean {
    return this.draft.reviews.some((review) => review.status !== 'approved');
  }

  isSentenceDiscussed(index: number): boolean {
    return this.activeDiscussions.some((discussion) => discussion.sentenceIndex === index && !discussion.resolved);
  }

  get nextVersion(): string {
    const numbers = this.draft.version.match(/\d+/g)?.map(Number) ?? [1, 2, 0];
    return `${numbers[0] || 1}.${(numbers[1] || 0) + 1}.0`;
  }

  get versionDiff(): DiffRow[] {
    const base = this.draft.versions.find((version) => version.id === this.compareBaseId);
    const target = this.draft.versions.find((version) => version.id === this.compareTargetId);
    if (!base || !target) return [];
    const baseLanguage = base.languages.find((language) => language.id === this.selectedLanguageId);
    const targetLanguage = target.languages.find((language) => language.id === this.selectedLanguageId);
    return this.diffSentences(this.splitSentences(baseLanguage?.body ?? ''), this.splitSentences(targetLanguage?.body ?? ''));
  }

  updateMeta(field: 'title' | 'eventType' | 'severity' | 'scope' | 'eventAt' | 'effectiveAt' | 'expiresAt', value: string): void {
    this.commit((draft) => {
      (draft as unknown as Record<string, unknown>)[field] = value;
      draft.status = draft.status === 'locked' ? 'draft' : draft.status;
    });
  }

  toggleChannel(channel: string, checked: boolean): void {
    this.commit((draft) => {
      draft.channels = checked ? [...new Set([...draft.channels, channel])] : draft.channels.filter((item) => item !== channel);
    });
  }

  toggleRequiredLocale(locale: string, checked: boolean): void {
    this.commit((draft) => {
      draft.requiredLocales = checked
        ? [...new Set([...draft.requiredLocales, locale])]
        : draft.requiredLocales.filter((item) => item !== locale);
    });
  }

  updateLanguage(field: 'title' | 'body' | 'translator', value: string): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) language[field] = value;
    });
  }

  setLanguageReviewed(checked: boolean): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) language.reviewed = checked;
    });
  }

  addLanguage(): void {
    const locale = this.locales.find((item) => item.id === this.newLanguageId);
    if (!locale || this.isLocked) return;
    if (this.draft.languages.some((language) => language.id === locale.id)) {
      this.toastr.info('该语言版本已存在。', '语言版本');
      return;
    }
    if (this.draft.languages.length >= MAX_LANGUAGES) {
      this.toastr.danger(`语言版本已达 ${MAX_LANGUAGES} 个上限，拒绝继续并入。`, '超出语言上限');
      return;
    }
    this.commit((draft) => {
      draft.languages.push({ id: locale.id, locale: locale.id, name: locale.name, title: '', body: '', translator: '', reviewed: false });
    });
    this.selectedLanguageId = locale.id;
    this.newLanguageId = '';
    this.toastr.success(`已添加${locale.name}版本，请完成翻译与复核。`, '语言版本');
  }

  selectSentence(index: number): void {
    this.selectedSentenceIndex = index;
  }

  addDiscussion(): void {
    const text = this.discussionText.trim();
    if (!text || this.isLocked) return;
    this.commit((draft) => {
      draft.discussions.push({
        id: uid('discussion'), languageId: this.selectedLanguageId, sentenceIndex: this.selectedSentenceIndex,
        author: this.currentRole === '法务' ? '陈冉' : this.currentRole === '翻译' ? '周晴' : '林晓',
        role: `${this.currentRole}审阅`, text, createdAt: new Date().toISOString(), resolved: false
      });
    });
    this.discussionText = '';
    this.toastr.success('讨论已绑定到当前句。', '已添加');
  }

  toggleDiscussion(discussionId: string): void {
    this.commit((draft) => {
      const item = draft.discussions.find((discussion) => discussion.id === discussionId);
      if (item) item.resolved = !item.resolved;
    });
  }

  setReviewStatus(role: RoleReview['role'], status: ReviewStatus): void {
    this.commit((draft) => {
      const review = draft.reviews.find((item) => item.role === role);
      if (review) {
        review.status = status;
        review.signature = status === 'approved' ? contentSignature(draft) : undefined;
      }
    });
  }

  setReviewNote(role: RoleReview['role'], note: string): void {
    this.commit((draft) => {
      const review = draft.reviews.find((item) => item.role === role);
      if (review) review.note = note;
    });
  }

  applyTemplate(): void {
    const template = this.templates.find((item) => item.id === this.selectedTemplateId);
    if (!template || this.isLocked) return;
    this.commit((draft) => {
      draft.eventType = template.eventType;
      draft.severity = template.severity;
      draft.scope = template.scope;
      draft.channels = [...template.channels];
      draft.languages.forEach((language) => {
        language.title = template.title[language.id] ?? language.title;
        language.body = template.body[language.id] ?? language.body;
        language.reviewed = false;
      });
    });
    this.toastr.success(`已应用“${template.name}”模板，请根据事件信息调整。`, '模板复用');
  }

  /** 冻结发布包：冻结前重新核对全部必需语言、未解决讨论和角色确认。 */
  lockVersion(): void {
    if (this.mergeState) {
      this.toastr.warning('存在待处理的并发冲突，请先完成冲突核对。', '无法冻结');
      this.activeView = 'sync';
      return;
    }
    if (this.blockingChecks.length) {
      this.toastr.warning(`仍有 ${this.blockingChecks.length} 项阻断问题，不能冻结。`, '发布检查未通过');
      this.activeView = 'checks';
      return;
    }
    if (this.unresolvedDiscussionCount) {
      this.toastr.warning(`仍有 ${this.unresolvedDiscussionCount} 条讨论未解决，冻结前需要全部处理。`, '发布核对未通过');
      this.activeView = 'review';
      return;
    }
    if (!this.allReviewsApproved) {
      this.toastr.warning('角色确认未完成或已失效，冻结前需要全部角色重新确认。', '发布核对未通过');
      this.activeView = 'review';
      return;
    }
    if (this.draft.languages.length > MAX_LANGUAGES) {
      this.toastr.danger(`语言版本超过 ${MAX_LANGUAGES} 个，拒绝冻结。`, '发布核对未通过');
      return;
    }
    const snapshot: VersionSnapshot = {
      id: uid('version'), label: '最终锁定版本', createdAt: new Date().toISOString(), version: this.nextVersion,
      title: this.draft.title, severity: this.draft.severity, scope: this.draft.scope, eventAt: this.draft.eventAt,
      effectiveAt: this.draft.effectiveAt, expiresAt: this.draft.expiresAt, channels: [...this.draft.channels],
      languages: clone(this.draft.languages), note: '发布前检查通过并锁定。', emergency: false
    };
    this.locks = [...this.locks, { id: uid('lock'), action: 'lock', version: snapshot.version, at: snapshot.createdAt, by: this.currentRole }];
    this.commit((draft) => {
      draft.versions.push(snapshot);
      draft.version = snapshot.version;
      draft.status = 'locked';
      draft.lockedAt = snapshot.createdAt;
    });
    this.resetCompare();
    this.toastr.success(`版本 ${snapshot.version} 已冻结，发布包基线已推进。`, '最终版本已冻结');
  }

  startEmergencyRevision(): void {
    if (!this.isLocked) return;
    const baseVersion = this.draft.version.split('-')[0];
    const [major = 1, minor = 0] = baseVersion.split('.').map(Number);
    const nextVersion = `${major}.${minor + 1}.0-emergency`;
    this.locks = [...this.locks, { id: uid('lock'), action: 'emergency-revision', version: nextVersion, at: new Date().toISOString(), by: this.currentRole }];
    this.commit((draft) => {
      draft.status = 'draft';
      draft.emergencyRevision = true;
      draft.version = nextVersion;
      draft.lockedAt = undefined;
    });
    this.activeView = 'compose';
    this.toastr.warning('已创建紧急修订稿；锁定版本仍完整保留。', '进入紧急修订');
  }

  showCheck(check: CheckResult): void {
    if (check.id.startsWith('missing-') || check.id.startsWith('required-') || check.id.startsWith('banned-') || check.id.startsWith('term-')) {
      const locale = check.id.split('-').at(-1);
      if (locale && this.draft.languages.some((language) => language.id === locale)) this.selectedLanguageId = locale;
      this.activeView = 'compose';
    } else if (check.id === 'discussions' || check.id === 'reviews-stale') {
      this.activeView = 'review';
    }
  }

  undo(): void {
    if (this.mergeState) {
      this.toastr.info('冲突核对期间暂不能撤销，请先完成合并。', '撤销');
      return;
    }
    const previous = this.history.pop();
    if (!previous) {
      this.toastr.info('没有可撤销的操作。', '撤销');
      return;
    }
    this.future.push(clone(this.draft));
    this.draft = previous;
    this.writeThrough();
  }

  redo(): void {
    if (this.mergeState) {
      this.toastr.info('冲突核对期间暂不能重做，请先完成合并。', '重做');
      return;
    }
    const next = this.future.pop();
    if (!next) {
      this.toastr.info('没有可重做的操作。', '重做');
      return;
    }
    this.history.push(clone(this.draft));
    this.draft = next;
    this.writeThrough();
  }

  saveNow(): void {
    this.writeThrough();
  }

  /** 模拟断网/恢复：离线时修改只进本机离线草稿，恢复后自动合并。 */
  toggleOffline(): void {
    this.manualOffline = !this.manualOffline;
    if (this.manualOffline) {
      this.saveOfflineEntry();
      this.toastr.warning('已切换为离线状态，修改仅保存到本机离线草稿。', '离线模式');
    } else {
      this.toastr.info('网络已恢复，正在同步离线草稿…', '重新连接');
      this.flushOffline();
    }
  }

  resolveConflict(conflict: ConflictItem, choice: 'ours' | 'theirs'): void {
    conflict.resolution = choice;
    this.applyResolution(conflict, choice === 'ours' ? conflict.oursValue : conflict.theirsValue);
    this.ensureSelection();
    this.saveOfflineEntry();
  }

  resolveAll(choice: 'ours' | 'theirs'): void {
    this.mergeState?.conflicts.forEach((conflict) => this.resolveConflict(conflict, choice));
  }

  /** 全部冲突处理完毕后，把合并结果写回共享发布包。 */
  completeMerge(): void {
    if (!this.mergeState) return;
    if (this.pendingConflicts.length) {
      this.toastr.warning(`还有 ${this.pendingConflicts.length} 项重叠修改待处理。`, '冲突未处理完');
      return;
    }
    if (!this.isOnline) {
      this.toastr.warning('当前处于离线状态，恢复网络后再写入合并结果。', '离线中');
      return;
    }
    const stored = this.readPackage(this.packageId);
    if (stored && stored.revision !== this.mergeState.storedRevision) {
      this.rebaseMerge(stored);
      this.toastr.warning('对方又有新的修改，已基于最新发布包重新核对。', '冲突更新');
      return;
    }
    const nextRevision = (stored?.revision ?? this.mergeState.storedRevision) + 1;
    this.mergeState = null;
    this.writePackage(nextRevision);
    this.ensureSelection();
    this.resetCompare();
    this.activeView = 'compose';
    this.toastr.success(`合并结果已写入发布包（基线 r${nextRevision}）。`, '冲突已解决');
  }

  switchPackage(id: string): void {
    if (id === this.packageId) return;
    if (this.mergeState) {
      this.toastr.warning('请先完成当前的冲突核对。', '冲突待处理');
      return;
    }
    this.packageId = id;
    this.history = [];
    this.future = [];
    this.activeView = 'compose';
    this.loadPackage();
  }

  formatDateTime(value: string): string {
    if (!value) return '未设置';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  private commit(mutator: (draft: NoticeDraft) => void): void {
    this.history.push(clone(this.draft));
    if (this.history.length > 50) this.history.shift();
    const next = clone(this.draft);
    mutator(next);
    next.updatedAt = new Date().toISOString();
    this.draft = next;
    this.future = [];
    this.writeThrough();
  }

  /**
   * 写穿到共享发布包：只有基线一致时才落盘，否则保留离线草稿并进入冲突核对；
   * 离线或合并进行中时只写本机离线草稿。
   */
  private writeThrough(): void {
    if (!this.baseline) return;
    const unchanged = deepEqual(this.draft, this.baseline.notice) && deepEqual(this.locks, this.baseline.locks);
    if (unchanged) {
      this.clearOffline();
      this.touchSaved();
      return;
    }
    if (!this.isOnline || this.mergeState) {
      this.saveOfflineEntry();
      this.touchSaved();
      return;
    }
    const stored = this.readPackage(this.packageId);
    if (stored && stored.revision !== this.revision) {
      this.enterConflict(stored);
      return;
    }
    this.writePackage((stored?.revision ?? this.revision) + 1);
  }

  private writePackage(revision: number): void {
    const pkg: ReleasePackage = {
      id: this.packageId,
      revision,
      notice: clone(this.draft),
      locks: clone(this.locks),
      updatedAt: new Date().toISOString(),
      updatedBy: this.tabId
    };
    localStorage.setItem(packageKey(this.packageId), JSON.stringify(pkg));
    this.revision = revision;
    this.baseline = { revision, notice: clone(this.draft), locks: clone(this.locks) };
    this.clearOffline();
    this.touchSaved();
  }

  /** 陈旧窗口：保留离线草稿，并基于基线做三方合并进入冲突核对。 */
  private enterConflict(stored: ReleasePackage): void {
    if (!this.baseline) return;
    this.saveOfflineEntry();
    const outcome = mergeNotices(this.baseline.notice, this.draft, stored.notice);
    this.locks = mergeLocks(this.baseline.locks, this.locks, stored.locks);
    this.mergeState = {
      baseRevision: this.revision,
      storedRevision: stored.revision,
      theirs: { revision: stored.revision, notice: clone(stored.notice), locks: clone(stored.locks) },
      conflicts: outcome.conflicts,
      autoMerged: outcome.autoMerged,
      refused: outcome.refused
    };
    this.draft = outcome.merged;
    this.ensureSelection();
    this.resetCompare();
    this.activeView = 'sync';
    this.toastr.warning('检测到另一窗口已更新此发布包，当前草稿已保留为离线草稿，请完成冲突核对。', '版本冲突');
  }

  /** 对方在我们核对期间又推进了版本：以对方上一版为公共祖先重新合并。 */
  private rebaseMerge(stored: ReleasePackage): void {
    if (!this.mergeState) return;
    const outcome = mergeNotices(this.mergeState.theirs.notice, this.draft, stored.notice);
    this.locks = mergeLocks(this.mergeState.theirs.locks, this.locks, stored.locks);
    this.mergeState = {
      baseRevision: this.mergeState.storedRevision,
      storedRevision: stored.revision,
      theirs: { revision: stored.revision, notice: clone(stored.notice), locks: clone(stored.locks) },
      conflicts: outcome.conflicts,
      autoMerged: outcome.autoMerged,
      refused: outcome.refused
    };
    this.draft = outcome.merged;
    this.ensureSelection();
    this.saveOfflineEntry();
  }

  /** 网络恢复后同步离线草稿：基线一致直接写入，不一致进入冲突核对。 */
  private flushOffline(): void {
    if (!this.isOnline || this.mergeState || !this.baseline) return;
    if (!this.readOffline(this.packageId)) return;
    const stored = this.readPackage(this.packageId);
    if (stored && stored.revision !== this.revision) {
      this.enterConflict(stored);
      return;
    }
    this.writeThrough();
    if (!this.mergeState) this.toastr.success('离线草稿已同步到共享发布包。', '同步完成');
  }

  private applyResolution(conflict: ConflictItem, value: unknown): void {
    const draft = this.draft;
    switch (conflict.kind) {
      case 'meta':
      case 'list':
        if (conflict.field) (draft as unknown as Record<string, unknown>)[conflict.field] = clone(value);
        break;
      case 'language-field': {
        const language = draft.languages.find((item) => item.id === conflict.languageId);
        if (language && conflict.field) (language as unknown as Record<string, unknown>)[conflict.field] = clone(value);
        break;
      }
      case 'language-presence': {
        const index = draft.languages.findIndex((item) => item.id === conflict.languageId);
        if (value === null) {
          if (index >= 0) draft.languages.splice(index, 1);
        } else if (index >= 0) {
          draft.languages[index] = clone(value) as LanguageVersion;
        } else {
          draft.languages.push(clone(value) as LanguageVersion);
        }
        break;
      }
      case 'review': {
        const review = draft.reviews.find((item) => item.role === conflict.role);
        if (review) Object.assign(review, clone(value));
        break;
      }
      case 'discussion': {
        const index = draft.discussions.findIndex((item) => item.id === conflict.discussionId);
        if (value === null) {
          if (index >= 0) draft.discussions.splice(index, 1);
        } else if (index >= 0) {
          Object.assign(draft.discussions[index], clone(value));
        } else {
          draft.discussions.push(clone(value) as Discussion);
        }
        break;
      }
    }
  }

  private loadPackage(): void {
    const pkg = this.readPackage(this.packageId);
    if (!pkg) return;
    this.revision = pkg.revision;
    this.locks = clone(pkg.locks);
    this.baseline = { revision: pkg.revision, notice: clone(pkg.notice), locks: clone(pkg.locks) };
    this.draft = clone(pkg.notice);
    this.mergeState = null;
    const offline = this.readOffline(this.packageId);
    if (offline?.draft) {
      if (offline.baseRevision === pkg.revision) {
        this.draft = clone(offline.draft);
        this.locks = clone(offline.draftLocks ?? []);
        if (this.isOnline) this.writeThrough();
      } else {
        this.revision = offline.baseRevision;
        this.baseline = { revision: offline.baseRevision, notice: clone(offline.notice), locks: clone(offline.locks ?? []) };
        this.draft = clone(offline.draft);
        this.locks = clone(offline.draftLocks ?? []);
        this.enterConflict(pkg);
      }
    }
    this.ensureSelection();
    this.resetCompare();
    this.lastSavedAt = this.formatDateTime(this.draft.updatedAt);
  }

  /** 旧数据升级：每个通知独立成包，历史版本随包保留、照常比较。 */
  private migrateStorage(): void {
    if (localStorage.getItem(PACKAGE_INDEX_KEY)) return;
    const packages: ReleasePackage[] = [];
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw) as unknown;
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        candidates.forEach((candidate) => {
          const notice = migrateNotice(candidate);
          if (notice) {
            packages.push({
              id: notice.id, revision: 1, notice, locks: deriveLocks(notice),
              updatedAt: notice.updatedAt, updatedBy: '数据迁移'
            });
          }
        });
      } catch {
        // 旧数据损坏时按无数据处理
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    if (!packages.length) {
      const notice = migrateNotice(initialDraft()) as NoticeDraft;
      packages.push({ id: notice.id, revision: 1, notice, locks: [], updatedAt: notice.updatedAt, updatedBy: '系统初始化' });
    }
    localStorage.setItem(PACKAGE_INDEX_KEY, JSON.stringify(packages.map((pkg) => pkg.id)));
    packages.forEach((pkg) => localStorage.setItem(packageKey(pkg.id), JSON.stringify(pkg)));
  }

  private readIndex(): string[] {
    try {
      const raw = localStorage.getItem(PACKAGE_INDEX_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  private readPackage(id: string): ReleasePackage | null {
    try {
      const raw = localStorage.getItem(packageKey(id));
      if (!raw) return null;
      const pkg = JSON.parse(raw) as ReleasePackage;
      return pkg && typeof pkg.revision === 'number' && pkg.notice ? pkg : null;
    } catch {
      return null;
    }
  }

  private readOffline(id: string): OfflineEntry | null {
    try {
      const raw = localStorage.getItem(offlineKey(id));
      return raw ? (JSON.parse(raw) as OfflineEntry) : null;
    } catch {
      return null;
    }
  }

  private saveOfflineEntry(): void {
    if (!this.baseline) return;
    const entry: OfflineEntry = {
      baseRevision: this.revision,
      notice: clone(this.baseline.notice),
      locks: clone(this.baseline.locks),
      draft: clone(this.draft),
      draftLocks: clone(this.locks),
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(offlineKey(this.packageId), JSON.stringify(entry));
  }

  private clearOffline(): void {
    if (this.packageId) localStorage.removeItem(offlineKey(this.packageId));
  }

  private ensureSelection(): void {
    if (!this.draft.languages.some((language) => language.id === this.selectedLanguageId)) {
      this.selectedLanguageId = this.draft.languages[0]?.id ?? '';
    }
    this.selectedSentenceIndex = 0;
  }

  private resetCompare(): void {
    this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
  }

  private touchSaved(): void {
    this.lastSavedAt = this.formatDateTime(new Date().toISOString());
  }

  private splitSentences(text: string): string[] {
    return (text.match(/[^。！？.!?]+[。！？.!?]?/g) ?? []).map((item) => item.trim()).filter(Boolean);
  }

  private toTime(value: string): number {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private diffSentences(left: string[], right: string[]): DiffRow[] {
    const rows: DiffRow[] = [];
    const lcs: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        lcs[i][j] = left[i] === right[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        rows.push({ left: left[i], right: right[j], kind: 'same' }); i++; j++;
      } else if (i < left.length && j < right.length && lcs[i + 1][j] === lcs[i][j] && lcs[i][j + 1] === lcs[i][j]) {
        rows.push({ left: left[i], right: right[j], kind: 'changed' }); i++; j++;
      } else if (j < right.length && (i === left.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
        rows.push({ left: '', right: right[j], kind: 'added' }); j++;
      } else if (i < left.length) {
        rows.push({ left: left[i], right: '', kind: 'removed' }); i++;
      }
    }
    return rows;
  }
}
