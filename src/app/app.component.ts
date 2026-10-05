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

type WorkspaceView = 'compose' | 'checks' | 'review' | 'versions' | 'sync';
type ReviewStatus = 'pending' | 'approved' | 'changes';
type NoticeStatus = 'draft' | 'in-review' | 'locked';
type CheckLevel = 'error' | 'warning' | 'info';

interface LanguageVersion {
  id: string;
  locale: string;
  name: string;
  title: string;
  body: string;
  translator: string;
  reviewed: boolean;
}

interface Discussion {
  id: string;
  languageId: string;
  sentenceIndex: number;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

interface RoleReview {
  role: '编辑' | '法务' | '翻译' | '发布人';
  owner: string;
  status: ReviewStatus;
  note: string;
}

interface VersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  version: string;
  title: string;
  severity: string;
  scope: string;
  eventAt: string;
  effectiveAt: string;
  expiresAt: string;
  channels: string[];
  languages: LanguageVersion[];
  note: string;
  emergency: boolean;
}

interface NoticeDraft {
  id: string;
  title: string;
  eventType: string;
  severity: string;
  scope: string;
  channels: string[];
  eventAt: string;
  effectiveAt: string;
  expiresAt: string;
  requiredLocales: string[];
  languages: LanguageVersion[];
  discussions: Discussion[];
  reviews: RoleReview[];
  versions: VersionSnapshot[];
  status: NoticeStatus;
  version: string;
  lockedAt?: string;
  emergencyRevision: boolean;
  updatedAt: string;
}

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

interface LockAction {
  id: string;
  action: 'lock' | 'emergency-revision';
  actor: string;
  version: string;
  at: string;
  note: string;
}

interface MergeConflict {
  id: string;
  path: string;
  label: string;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
  status: 'pending' | 'resolved';
  resolution?: 'ours' | 'theirs';
}

interface ReleasePackage {
  id: string;
  noticeId: string;
  revision: number;
  updatedAt: string;
  draft: NoticeDraft;
  lockLog: LockAction[];
  conflicts: MergeConflict[];
}

interface PackageStore {
  packages: ReleasePackage[];
  activePackageId: string;
}

interface OfflineRecord {
  packageId: string;
  baseRevision: number;
  draft: NoticeDraft;
  savedAt: string;
  reason: 'offline' | 'conflict';
}

const STORE_KEY = 'sologsb-1025-release-packages-v2';
const LEGACY_KEY = 'sologsb-1025-emergency-notice-v1';
const OFFLINE_PREFIX = 'sologsb-1025-offline-';
const MAX_LANGUAGES = 8;

const META_LABELS: Record<string, string> = {
  title: '通知标题', eventType: '事件类型', severity: '严重程度', scope: '影响范围',
  eventAt: '事件时间', effectiveAt: '生效时间', expiresAt: '失效时间',
  status: '草稿状态', version: '版本号', lockedAt: '锁定时间', emergencyRevision: '紧急修订标记'
};

const LANGUAGE_FIELD_LABELS: Record<string, string> = {
  title: '标题', body: '正文', translator: '译者', reviewed: '复核状态'
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneValue = <T>(value: T): T => (value === undefined || value === null ? value : clone(value));

const eq = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultReviews(): RoleReview[] {
  return [
    { role: '编辑', owner: '林晓', status: 'pending', note: '' },
    { role: '法务', owner: '陈冉', status: 'pending', note: '' },
    { role: '翻译', owner: '周晴', status: 'pending', note: '' },
    { role: '发布人', owner: '值班中心', status: 'pending', note: '' }
  ];
}

function blankDraft(): NoticeDraft {
  return {
    id: uid('notice'),
    title: '',
    eventType: '台风',
    severity: '黄色',
    scope: '',
    channels: ['短信'],
    eventAt: '',
    effectiveAt: '',
    expiresAt: '',
    requiredLocales: ['zh-CN'],
    languages: [
      { id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: '', body: '', translator: '', reviewed: false }
    ],
    discussions: [],
    reviews: defaultReviews(),
    versions: [],
    status: 'draft',
    version: '0.1.0-draft',
    emergencyRevision: false,
    updatedAt: new Date().toISOString()
  };
}

function mergeDrafts(base: NoticeDraft, theirs: NoticeDraft, ours: NoticeDraft): { merged: NoticeDraft; conflicts: MergeConflict[] } {
  const conflicts: MergeConflict[] = [];
  const merged = clone(theirs);
  const addConflict = (path: string, label: string, baseValue: unknown, ourValue: unknown, theirValue: unknown): void => {
    conflicts.push({
      id: uid('conflict'), path, label,
      base: cloneValue(baseValue), ours: cloneValue(ourValue), theirs: cloneValue(theirValue),
      status: 'pending'
    });
  };

  const baseMeta = base as unknown as Record<string, unknown>;
  const theirMeta = theirs as unknown as Record<string, unknown>;
  const ourMeta = ours as unknown as Record<string, unknown>;
  const mergedMeta = merged as unknown as Record<string, unknown>;
  const scalarFields: Array<[string, string]> = [
    ...Object.entries(META_LABELS),
    ['channels', '目标渠道'],
    ['requiredLocales', '必需语言']
  ];
  scalarFields.forEach(([field, label]) => {
    if (eq(ourMeta[field], baseMeta[field])) return;
    if (eq(theirMeta[field], baseMeta[field]) || eq(ourMeta[field], theirMeta[field])) {
      mergedMeta[field] = cloneValue(ourMeta[field]);
      return;
    }
    addConflict(field in META_LABELS ? `meta.${field}` : field, label, baseMeta[field], ourMeta[field], theirMeta[field]);
  });

  const languageIds = [...new Set([...base.languages, ...theirs.languages, ...ours.languages].map((language) => language.id))];
  const languageName = (id: string): string =>
    [...ours.languages, ...theirs.languages, ...base.languages].find((language) => language.id === id)?.name ?? id;
  const mergedLanguages: LanguageVersion[] = [];
  languageIds.forEach((id) => {
    const baseLanguage = base.languages.find((language) => language.id === id);
    const theirLanguage = theirs.languages.find((language) => language.id === id);
    const ourLanguage = ours.languages.find((language) => language.id === id);
    const name = languageName(id);
    if (baseLanguage && theirLanguage && ourLanguage) {
      if (eq(theirLanguage, baseLanguage)) { mergedLanguages.push(clone(ourLanguage)); return; }
      if (eq(ourLanguage, baseLanguage) || eq(ourLanguage, theirLanguage)) { mergedLanguages.push(clone(theirLanguage)); return; }
      const language = clone(theirLanguage);
      const languageRecord = language as unknown as Record<string, unknown>;
      (['title', 'body', 'translator', 'reviewed'] as const).forEach((field) => {
        if (eq(ourLanguage[field], baseLanguage[field])) return;
        if (eq(theirLanguage[field], baseLanguage[field]) || eq(ourLanguage[field], theirLanguage[field])) {
          languageRecord[field] = cloneValue(ourLanguage[field]);
          return;
        }
        addConflict(`language.${id}.${field}`, `${name}·${LANGUAGE_FIELD_LABELS[field]}`, baseLanguage[field], ourLanguage[field], theirLanguage[field]);
      });
      mergedLanguages.push(language);
      return;
    }
    if (baseLanguage && theirLanguage && !ourLanguage) {
      if (!eq(theirLanguage, baseLanguage)) addConflict(`language.${id}`, `${name}语言版本（我方已移除）`, baseLanguage, undefined, theirLanguage);
      return;
    }
    if (baseLanguage && !theirLanguage && ourLanguage) {
      if (!eq(ourLanguage, baseLanguage)) addConflict(`language.${id}`, `${name}语言版本（对方已移除）`, baseLanguage, ourLanguage, undefined);
      return;
    }
    if (!baseLanguage && theirLanguage && ourLanguage) {
      if (eq(ourLanguage, theirLanguage)) mergedLanguages.push(clone(ourLanguage));
      else addConflict(`language.${id}`, `${name}语言版本（双方均新增）`, undefined, ourLanguage, theirLanguage);
      return;
    }
    if (!baseLanguage && theirLanguage) { mergedLanguages.push(clone(theirLanguage)); return; }
    if (!baseLanguage && ourLanguage) mergedLanguages.push(clone(ourLanguage));
  });
  if (mergedLanguages.length > MAX_LANGUAGES) {
    mergedLanguages.splice(MAX_LANGUAGES).forEach((language) => {
      addConflict(
        `language.${language.id}`, `${language.name}语言版本（超过 ${MAX_LANGUAGES} 个上限，拒绝并入）`,
        base.languages.find((item) => item.id === language.id),
        ours.languages.find((item) => item.id === language.id),
        theirs.languages.find((item) => item.id === language.id)
      );
    });
  }
  merged.languages = mergedLanguages;

  const discussionIds = [...new Set([...base.discussions, ...theirs.discussions, ...ours.discussions].map((discussion) => discussion.id))];
  const mergedDiscussions: Discussion[] = [];
  discussionIds.forEach((id) => {
    const baseDiscussion = base.discussions.find((discussion) => discussion.id === id);
    const theirDiscussion = theirs.discussions.find((discussion) => discussion.id === id);
    const ourDiscussion = ours.discussions.find((discussion) => discussion.id === id);
    const sample = (ourDiscussion ?? theirDiscussion ?? baseDiscussion)?.text ?? '';
    const label = `讨论“${sample.length > 18 ? `${sample.slice(0, 18)}…` : sample}”`;
    if (baseDiscussion && theirDiscussion && ourDiscussion) {
      if (eq(theirDiscussion, baseDiscussion)) { mergedDiscussions.push(clone(ourDiscussion)); return; }
      if (eq(ourDiscussion, baseDiscussion) || eq(ourDiscussion, theirDiscussion)) { mergedDiscussions.push(clone(theirDiscussion)); return; }
      addConflict(`discussion.${id}`, label, baseDiscussion, ourDiscussion, theirDiscussion);
      mergedDiscussions.push(clone(theirDiscussion));
      return;
    }
    if (baseDiscussion && theirDiscussion && !ourDiscussion) {
      if (eq(theirDiscussion, baseDiscussion)) return;
      addConflict(`discussion.${id}`, label, baseDiscussion, undefined, theirDiscussion);
      mergedDiscussions.push(clone(theirDiscussion));
      return;
    }
    if (baseDiscussion && !theirDiscussion && ourDiscussion) {
      if (eq(ourDiscussion, baseDiscussion)) return;
      addConflict(`discussion.${id}`, label, baseDiscussion, ourDiscussion, undefined);
      return;
    }
    if (!baseDiscussion && theirDiscussion && ourDiscussion) {
      if (eq(ourDiscussion, theirDiscussion)) { mergedDiscussions.push(clone(ourDiscussion)); return; }
      addConflict(`discussion.${id}`, label, undefined, ourDiscussion, theirDiscussion);
      mergedDiscussions.push(clone(theirDiscussion));
      return;
    }
    if (!baseDiscussion && theirDiscussion) { mergedDiscussions.push(clone(theirDiscussion)); return; }
    if (!baseDiscussion && ourDiscussion) mergedDiscussions.push(clone(ourDiscussion));
  });
  merged.discussions = mergedDiscussions;

  const roleNames = [...new Set([...base.reviews, ...theirs.reviews, ...ours.reviews].map((review) => review.role))];
  merged.reviews = roleNames.map((role) => {
    const baseReview = base.reviews.find((review) => review.role === role);
    const theirReview = theirs.reviews.find((review) => review.role === role);
    const ourReview = ours.reviews.find((review) => review.role === role);
    if (baseReview && theirReview && ourReview) {
      if (eq(theirReview, baseReview)) return clone(ourReview);
      if (eq(ourReview, baseReview) || eq(ourReview, theirReview)) return clone(theirReview);
      const review = clone(theirReview);
      const reviewRecord = review as unknown as Record<string, unknown>;
      (['status', 'note'] as const).forEach((field) => {
        if (eq(ourReview[field], baseReview[field])) return;
        if (eq(theirReview[field], baseReview[field]) || eq(ourReview[field], theirReview[field])) {
          reviewRecord[field] = cloneValue(ourReview[field]);
          return;
        }
        addConflict(`review.${role}.${field}`, `${role}·${field === 'status' ? '确认状态' : '审阅备注'}`, baseReview[field], ourReview[field], theirReview[field]);
      });
      return review;
    }
    return clone((ourReview ?? theirReview ?? baseReview) as RoleReview);
  });

  const versionsById = new Map<string, VersionSnapshot>();
  [...theirs.versions, ...ours.versions].forEach((version) => versionsById.set(version.id, version));
  merged.versions = [...versionsById.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return { merged, conflicts };
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

  return {
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
  readonly maxLanguages = MAX_LANGUAGES;
  readonly eventTypes = ['台风', '暴雨', '地震', '公共卫生', '公共设施', '公共安全'];
  readonly severities = ['蓝色', '黄色', '橙色', '红色'];
  readonly channelOptions = ['短信', '广播', '社区大屏', '政务新媒体', '应急喇叭', '网站'];
  readonly locales = [
    { id: 'zh-CN', name: '简体中文' },
    { id: 'en', name: 'English' },
    { id: 'ja', name: '日本語' },
    { id: 'ko', name: '한국어' },
    { id: 'es', name: 'Español' },
    { id: 'fr', name: 'Français' },
    { id: 'de', name: 'Deutsch' },
    { id: 'ru', name: 'Русский' },
    { id: 'ar', name: 'العربية' },
    { id: 'pt', name: 'Português' }
  ];
  readonly bannedTerms = ['大概', '可能吧', '无需恐慌', '绝对不会', '保证安全'];
  readonly glossary = [
    { canonical: '立即', variants: ['马上', '赶紧'] },
    { canonical: '安置点', variants: ['避难所', '庇护所'] },
    { canonical: '持续关注', variants: ['随时留意', '保持观看'] }
  ];
  readonly roles: RoleReview['role'][] = ['编辑', '法务', '翻译', '发布人'];

  packages: ReleasePackage[] = [];
  activePackageId = '';
  draft: NoticeDraft = initialDraft();
  baseRevision = 0;
  private baseDraft: NoticeDraft = initialDraft();
  offlineRecord: OfflineRecord | null = null;
  remotePending = false;
  browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  simulatedOffline = false;

  activeView: WorkspaceView = 'compose';
  selectedLanguageId = 'zh-CN';
  selectedSentenceIndex = 0;
  selectedTemplateId = 'typhoon';
  discussionText = '';
  currentRole: RoleReview['role'] = '编辑';
  compareBaseId = '';
  compareTargetId = '';
  newLocaleId = '';
  lastSavedAt = '';
  history: NoticeDraft[] = [];
  future: NoticeDraft[] = [];

  constructor(private readonly toastr: NbToastrService) {}

  ngOnInit(): void {
    const store = this.readStore();
    this.packages = store.packages;
    this.activePackageId = store.activePackageId;
    this.loadActivePackage();
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
    }
  }

  @HostListener('window:storage', ['$event'])
  handleStorage(event: StorageEvent): void {
    if (event.key !== STORE_KEY || !event.newValue) return;
    let store: PackageStore;
    try {
      store = JSON.parse(event.newValue) as PackageStore;
    } catch {
      return;
    }
    if (!store || !Array.isArray(store.packages)) return;
    this.packages = store.packages;
    const pkg = store.packages.find((item) => item.id === this.activePackageId);
    if (!pkg || pkg.revision === this.baseRevision) return;
    if (!this.isOnline || this.offlineRecord) {
      this.remotePending = true;
      return;
    }
    this.pullFromPackage(pkg);
  }

  @HostListener('window:online')
  handleOnline(): void {
    this.browserOnline = true;
    if (this.isOnline) this.syncNow();
  }

  @HostListener('window:offline')
  handleOffline(): void {
    this.browserOnline = false;
  }

  get isOnline(): boolean {
    return this.browserOnline && !this.simulatedOffline;
  }

  get activePackage(): ReleasePackage | undefined {
    return this.packages.find((pkg) => pkg.id === this.activePackageId);
  }

  get pendingConflicts(): MergeConflict[] {
    return this.activePackage?.conflicts.filter((conflict) => conflict.status === 'pending') ?? [];
  }

  get lockLog(): LockAction[] {
    return this.activePackage?.lockLog ?? [];
  }

  get availableLocales(): Array<{ id: string; name: string }> {
    return this.locales.filter((locale) => !this.draft.languages.some((language) => language.id === locale.id));
  }

  get selectedLanguage(): LanguageVersion {
    return this.draft.languages.find((language) => language.id === this.selectedLanguageId) ?? this.draft.languages[0];
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

    this.draft.reviews.forEach((review) => {
      if (review.status === 'changes') checks.push({
        id: `role-${review.role}`, category: '角色确认', level: 'error', title: `${review.role}退回了当前稿`,
        detail: review.note || '请根据退回意见修改后重新提交确认。'
      });
      else if (review.status === 'pending') checks.push({
        id: `role-${review.role}`, category: '角色确认', level: 'warning', title: `等待${review.role}确认`,
        detail: '冻结发布包前需要全部角色完成确认；正文变更会使确认失效。'
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
      detail: '冻结发布包前必须处理完全部讨论。'
    });
    if (this.pendingConflicts.length) checks.push({
      id: 'conflicts', category: '同步冲突', level: 'error', title: `${this.pendingConflicts.length} 处合并冲突待处理`,
      detail: '两个窗口修改了同一内容，重叠部分停在待处理状态，请在冲突核对中选择保留方案。'
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

  get allReviewsApproved(): boolean {
    return this.draft.reviews.every((review) => review.status === 'approved');
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
      if (!language) return;
      if ((field === 'title' || field === 'body') && language[field] !== value) {
        language.reviewed = false;
        draft.reviews.forEach((review) => {
          if (review.status === 'approved') review.status = 'pending';
        });
      }
      language[field] = value;
    });
  }

  setLanguageReviewed(checked: boolean): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) language.reviewed = checked;
    });
  }

  addLanguage(): void {
    const locale = this.locales.find((item) => item.id === this.newLocaleId);
    if (!locale || this.isLocked) return;
    if (this.draft.languages.length >= this.maxLanguages) {
      this.toastr.danger(`语言版本已达 ${this.maxLanguages} 个上限，拒绝继续并入。`, '超出语言上限');
      return;
    }
    if (this.draft.languages.some((language) => language.id === locale.id)) return;
    this.commit((draft) => {
      draft.languages.push({ id: locale.id, locale: locale.id, name: locale.name, title: '', body: '', translator: '', reviewed: false });
    });
    this.selectedLanguageId = locale.id;
    this.newLocaleId = '';
    this.toastr.success(`已添加${locale.name}版本，请完成翻译与复核。`, '语言版本');
  }

  removeLanguage(languageId: string): void {
    if (this.isLocked || this.draft.languages.length <= 1) return;
    const target = this.draft.languages.find((language) => language.id === languageId);
    if (!target) return;
    this.commit((draft) => {
      draft.languages = draft.languages.filter((language) => language.id !== languageId);
      draft.requiredLocales = draft.requiredLocales.filter((locale) => locale !== languageId);
      draft.discussions = draft.discussions.filter((discussion) => discussion.languageId !== languageId);
    });
    if (this.selectedLanguageId === languageId) this.selectedLanguageId = this.draft.languages[0]?.id ?? '';
    this.toastr.warning(`已移除${target.name}版本。`, '语言版本');
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
      if (review) review.status = status;
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
      draft.reviews.forEach((review) => {
        if (review.status === 'approved') review.status = 'pending';
      });
    });
    this.toastr.success(`已应用“${template.name}”模板，语言复核与角色确认已重置。`, '模板复用');
  }

  lockVersion(): void {
    if (this.isLocked) return;
    if (!this.isOnline) {
      this.toastr.warning('离线状态无法冻结发布包，请恢复网络并同步后再锁定。', '无法锁定');
      return;
    }
    if (this.offlineRecord) {
      this.toastr.warning('存在未同步的离线草稿，请先完成同步再冻结。', '无法锁定');
      this.activeView = 'sync';
      return;
    }
    if (this.pendingConflicts.length) {
      this.toastr.warning(`仍有 ${this.pendingConflicts.length} 处合并冲突待处理，不能冻结。`, '冲突未解决');
      this.activeView = 'sync';
      return;
    }
    if (this.draft.languages.length > this.maxLanguages) {
      this.toastr.danger(`语言版本超过 ${this.maxLanguages} 个，拒绝冻结发布包。`, '超出语言上限');
      return;
    }
    const incomplete = this.draft.requiredLocales.filter((locale) => {
      const language = this.draft.languages.find((item) => item.id === locale);
      return !language || !language.title.trim() || !language.body.trim();
    });
    if (incomplete.length) {
      const names = incomplete.map((locale) => this.locales.find((item) => item.id === locale)?.name ?? locale).join('、');
      this.toastr.danger(`必需语言未就绪：${names}。`, '无法锁定');
      this.activeView = 'checks';
      return;
    }
    if (this.blockingChecks.length) {
      this.toastr.warning(`仍有 ${this.blockingChecks.length} 项阻断问题，不能锁定。`, '发布检查未通过');
      this.activeView = 'checks';
      return;
    }
    if (this.unresolvedDiscussionCount) {
      this.toastr.warning(`仍有 ${this.unresolvedDiscussionCount} 条讨论未解决，不能冻结。`, '发布检查未通过');
      this.activeView = 'review';
      return;
    }
    if (!this.allReviewsApproved) {
      this.toastr.warning('仍有角色未确认，不能冻结发布包。', '发布检查未通过');
      this.activeView = 'review';
      return;
    }
    const snapshot: VersionSnapshot = {
      id: uid('version'), label: '最终锁定版本', createdAt: new Date().toISOString(), version: this.nextVersion,
      title: this.draft.title, severity: this.draft.severity, scope: this.draft.scope, eventAt: this.draft.eventAt,
      effectiveAt: this.draft.effectiveAt, expiresAt: this.draft.expiresAt, channels: [...this.draft.channels],
      languages: clone(this.draft.languages), note: '发布前检查通过并锁定。', emergency: false
    };
    this.commit((draft) => {
      draft.versions.push(snapshot);
      draft.version = snapshot.version;
      draft.status = 'locked';
      draft.lockedAt = snapshot.createdAt;
    });
    this.appendLockLog('lock', '发布前检查通过并锁定。');
    this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
    this.toastr.success(`版本 ${snapshot.version} 已锁定。`, '最终版本已冻结');
  }

  startEmergencyRevision(): void {
    if (!this.isOnline) {
      this.toastr.warning('离线状态无法发起紧急修订，请恢复网络并同步后再操作。', '无法修订');
      return;
    }
    const baseVersion = this.draft.version.split('-')[0];
    const [major = 1, minor = 0] = baseVersion.split('.').map(Number);
    this.commit((draft) => {
      draft.status = 'draft';
      draft.emergencyRevision = true;
      draft.version = `${major}.${minor + 1}.0-emergency`;
      draft.lockedAt = undefined;
    });
    this.appendLockLog('emergency-revision', '从锁定稿发起紧急修订。');
    this.activeView = 'compose';
    this.toastr.warning('已创建紧急修订稿；锁定版本仍完整保留。', '进入紧急修订');
  }

  showCheck(check: CheckResult): void {
    if (check.id === 'conflicts') {
      this.activeView = 'sync';
      return;
    }
    if (check.id.startsWith('role-') || check.id === 'discussions') {
      this.activeView = 'review';
      return;
    }
    if (check.id.startsWith('missing-') || check.id.startsWith('required-') || check.id.startsWith('banned-') || check.id.startsWith('term-')) {
      const locale = check.id.split('-').at(-1);
      if (locale && this.draft.languages.some((language) => language.id === locale)) this.selectedLanguageId = locale;
      this.activeView = 'compose';
    }
  }

  toggleOffline(): void {
    this.simulatedOffline = !this.simulatedOffline;
    if (this.simulatedOffline) {
      this.toastr.warning('已切换到离线模式，修改仅保存到本机离线草稿。', '离线');
      return;
    }
    this.toastr.success('网络已恢复，正在与发布包同步。', '在线');
    this.syncNow();
  }

  syncNow(manual = false): void {
    if (!this.isOnline) {
      if (manual) this.toastr.warning('当前处于离线状态，恢复网络后才能同步。', '无法同步');
      return;
    }
    if (this.offlineRecord) {
      this.pushDraft();
      return;
    }
    if (this.remotePending) {
      const pkg = this.readStore().packages.find((item) => item.id === this.activePackageId);
      if (pkg && pkg.revision !== this.baseRevision) this.pullFromPackage(pkg);
      else this.remotePending = false;
      return;
    }
    if (manual) this.toastr.info('发布包已是最新，无需同步。', '同步');
  }

  resolveConflict(conflict: MergeConflict, choice: 'ours' | 'theirs'): void {
    const value = choice === 'ours' ? conflict.ours : conflict.theirs;
    const parts = conflict.path.split('.');
    if (parts[0] === 'language' && parts.length === 2 && value != null) {
      const exists = this.draft.languages.some((language) => language.id === parts[1]);
      if (!exists && this.draft.languages.length >= this.maxLanguages) {
        this.toastr.danger(`语言版本已达 ${this.maxLanguages} 个上限，拒绝并入；请先移除其他语言。`, '超出语言上限');
        return;
      }
    }
    this.commit((draft) => this.applyConflictChoice(draft, conflict, choice));
    const store = this.readStore();
    const pkg = store.packages.find((item) => item.id === this.activePackageId);
    if (pkg) {
      const item = pkg.conflicts.find((entry) => entry.id === conflict.id);
      if (item) {
        item.status = 'resolved';
        item.resolution = choice;
      }
      pkg.revision += 1;
      pkg.updatedAt = new Date().toISOString();
      this.writeStore(store);
      this.baseRevision = pkg.revision;
    }
    if (!this.pendingConflicts.length) {
      this.clearOfflineRecord();
      this.toastr.success('全部冲突已处理，发布包恢复一致。', '冲突核对完成');
    }
  }

  conflictValue(value: unknown): string {
    if (value === undefined || value === null) return '（已删除）';
    if (typeof value === 'boolean') return value ? '已复核' : '待复核';
    if (typeof value === 'string') {
      const statusText: Record<string, string> = { pending: '待确认', approved: '已确认', changes: '退回修改' };
      if (statusText[value]) return statusText[value];
      if (!value) return '（空）';
      return value.length > 120 ? `${value.slice(0, 120)}…` : value;
    }
    if (Array.isArray(value)) return value.length ? value.join('、') : '（空）';
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if ('name' in record && 'title' in record) return `${record['name']}：${record['title'] || '（无标题）'}`;
      if ('text' in record) return String(record['text']);
      return JSON.stringify(value);
    }
    return String(value);
  }

  switchPackage(packageId: string): void {
    if (!packageId || packageId === this.activePackageId) return;
    const store = this.readStore();
    if (!store.packages.some((pkg) => pkg.id === packageId)) return;
    store.activePackageId = packageId;
    this.writeStore(store);
    this.activePackageId = packageId;
    this.loadActivePackage();
    this.activeView = 'compose';
  }

  createPackage(): void {
    const store = this.readStore();
    const pkg = this.wrapPackage(blankDraft());
    store.packages.push(pkg);
    store.activePackageId = pkg.id;
    this.writeStore(store);
    this.activePackageId = pkg.id;
    this.loadActivePackage();
    this.activeView = 'compose';
    this.toastr.success('已创建新的通知发布包，可离线起草。', '新建通知包');
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) {
      this.toastr.info('没有可撤销的操作。', '撤销');
      return;
    }
    this.future.push(clone(this.draft));
    this.draft = previous;
    this.pushDraft();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) {
      this.toastr.info('没有可重做的操作。', '重做');
      return;
    }
    this.history.push(clone(this.draft));
    this.draft = next;
    this.pushDraft();
  }

  saveNow(): void {
    if (!this.isOnline) {
      this.writeOfflineRecord(this.offlineRecord?.reason === 'conflict' ? 'conflict' : 'offline');
      this.toastr.success('离线草稿已保存在本机。', '保存成功');
      return;
    }
    if (this.offlineRecord || this.remotePending) {
      this.syncNow(true);
      return;
    }
    this.toastr.success('草稿已同步到发布包。', '保存成功');
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
    this.pushDraft();
  }

  private pushDraft(): void {
    if (!this.isOnline) {
      this.writeOfflineRecord(this.offlineRecord?.reason === 'conflict' ? 'conflict' : 'offline');
      return;
    }
    const store = this.readStore();
    const pkg = store.packages.find((item) => item.id === this.activePackageId);
    if (!pkg) return;
    if (pkg.revision === this.baseRevision) {
      pkg.revision += 1;
      pkg.draft = clone(this.draft);
      pkg.updatedAt = new Date().toISOString();
      this.writeStore(store);
      this.baseRevision = pkg.revision;
      this.baseDraft = clone(this.draft);
      if (this.offlineRecord?.reason !== 'conflict') this.clearOfflineRecord();
      this.remotePending = false;
      return;
    }
    const attempted = clone(this.draft);
    const staleBaseRevision = this.baseRevision;
    const { merged, conflicts } = mergeDrafts(this.baseDraft, pkg.draft, this.draft);
    pkg.revision += 1;
    pkg.draft = clone(merged);
    pkg.updatedAt = new Date().toISOString();
    pkg.conflicts = [...(pkg.conflicts ?? []), ...conflicts];
    this.writeStore(store);
    this.baseRevision = pkg.revision;
    this.baseDraft = clone(merged);
    this.draft = clone(merged);
    this.remotePending = false;
    if (conflicts.length) {
      this.writeOfflineRecord('conflict', attempted, staleBaseRevision);
      this.ensureSelectionValidity();
      this.toastr.warning(`${conflicts.length} 处内容与另一窗口重叠，已保留离线草稿并进入冲突核对。`, '合并冲突');
      this.activeView = 'sync';
      return;
    }
    this.clearOfflineRecord();
    this.ensureSelectionValidity();
    this.toastr.info('已合并另一窗口的更新，互未触碰的内容自动并入。', '同步完成');
  }

  private pullFromPackage(pkg: ReleasePackage): void {
    this.baseRevision = pkg.revision;
    this.baseDraft = clone(pkg.draft);
    this.draft = clone(pkg.draft);
    this.remotePending = false;
    this.history = [];
    this.future = [];
    this.ensureSelectionValidity();
    this.lastSavedAt = this.formatDateTime(pkg.updatedAt);
    this.toastr.info(`另一窗口已更新发布包（修订 ${pkg.revision}），本窗口已同步。`, '已同步');
  }

  private appendLockLog(action: LockAction['action'], note: string): void {
    const store = this.readStore();
    const pkg = store.packages.find((item) => item.id === this.activePackageId);
    if (!pkg) return;
    pkg.lockLog = [...(pkg.lockLog ?? []), {
      id: uid('lock'), action, actor: this.currentRole, version: this.draft.version, at: new Date().toISOString(), note
    }];
    pkg.revision += 1;
    pkg.updatedAt = new Date().toISOString();
    this.writeStore(store);
    this.baseRevision = pkg.revision;
  }

  private applyConflictChoice(draft: NoticeDraft, conflict: MergeConflict, choice: 'ours' | 'theirs'): void {
    const value = choice === 'ours' ? conflict.ours : conflict.theirs;
    const parts = conflict.path.split('.');
    if (parts[0] === 'meta') {
      (draft as unknown as Record<string, unknown>)[parts[1]] = cloneValue(value);
      return;
    }
    if (conflict.path === 'channels' || conflict.path === 'requiredLocales') {
      (draft as unknown as Record<string, unknown>)[conflict.path] = cloneValue(value);
      return;
    }
    if (parts[0] === 'language') {
      const languageId = parts[1];
      if (parts.length === 2) {
        if (value == null) {
          draft.languages = draft.languages.filter((language) => language.id !== languageId);
          return;
        }
        const language = clone(value) as LanguageVersion;
        const index = draft.languages.findIndex((item) => item.id === languageId);
        if (index >= 0) draft.languages[index] = language;
        else draft.languages.push(language);
        return;
      }
      const language = draft.languages.find((item) => item.id === languageId);
      if (language) (language as unknown as Record<string, unknown>)[parts[2]] = cloneValue(value);
      return;
    }
    if (parts[0] === 'review') {
      const review = draft.reviews.find((item) => item.role === parts[1]);
      if (review) (review as unknown as Record<string, unknown>)[parts[2]] = cloneValue(value);
      return;
    }
    if (parts[0] === 'discussion') {
      if (value == null) {
        draft.discussions = draft.discussions.filter((discussion) => discussion.id !== parts[1]);
        return;
      }
      const discussion = clone(value) as Discussion;
      const index = draft.discussions.findIndex((item) => item.id === discussion.id);
      if (index >= 0) draft.discussions[index] = discussion;
      else draft.discussions.push(discussion);
    }
  }

  private loadActivePackage(): void {
    const pkg = this.activePackage;
    if (!pkg) return;
    this.baseRevision = pkg.revision;
    this.baseDraft = clone(pkg.draft);
    this.offlineRecord = this.readOfflineRecord(pkg.id);
    this.draft = this.offlineRecord ? clone(this.offlineRecord.draft) : clone(pkg.draft);
    this.remotePending = false;
    this.history = [];
    this.future = [];
    this.ensureSelectionValidity();
    this.lastSavedAt = this.formatDateTime(pkg.updatedAt);
  }

  private ensureSelectionValidity(): void {
    if (!this.draft.languages.some((language) => language.id === this.selectedLanguageId)) {
      this.selectedLanguageId = this.draft.languages[0]?.id ?? 'zh-CN';
    }
    if (!this.draft.versions.some((version) => version.id === this.compareBaseId)) {
      this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    }
    if (!this.draft.versions.some((version) => version.id === this.compareTargetId)) {
      this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
    }
  }

  private readStore(): PackageStore {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PackageStore;
        if (parsed && Array.isArray(parsed.packages) && parsed.packages.length && parsed.packages.every((pkg) => pkg.draft?.id)) {
          parsed.packages.forEach((pkg) => {
            pkg.lockLog ??= [];
            pkg.conflicts ??= [];
          });
          if (!parsed.packages.some((pkg) => pkg.id === parsed.activePackageId)) {
            parsed.activePackageId = parsed.packages[0].id;
          }
          return parsed;
        }
      }
    } catch {
      // 数据损坏时重建发布包仓库
    }
    return this.buildInitialStore();
  }

  private buildInitialStore(): PackageStore {
    const drafts: NoticeDraft[] = [];
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy) as NoticeDraft | NoticeDraft[];
        const items = Array.isArray(parsed) ? parsed : [parsed];
        items.forEach((item) => {
          const migrated = this.migrate(item);
          if (migrated) drafts.push(migrated);
        });
      }
    } catch {
      // 旧数据损坏时改用初始草稿
    }
    if (!drafts.length) drafts.push(initialDraft());
    const packages = drafts.map((draft) => this.wrapPackage(draft));
    const store: PackageStore = { packages, activePackageId: packages[0].id };
    this.writeStore(store);
    return store;
  }

  private wrapPackage(draft: NoticeDraft): ReleasePackage {
    return {
      id: uid('pkg'),
      noticeId: draft.id,
      revision: 1,
      updatedAt: new Date().toISOString(),
      draft: clone(draft),
      lockLog: [],
      conflicts: []
    };
  }

  private writeStore(store: PackageStore): void {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    this.packages = store.packages;
    this.lastSavedAt = this.formatDateTime(new Date().toISOString());
  }

  private offlineKey(packageId: string): string {
    return `${OFFLINE_PREFIX}${packageId}`;
  }

  private readOfflineRecord(packageId: string): OfflineRecord | null {
    try {
      const raw = localStorage.getItem(this.offlineKey(packageId));
      if (raw) {
        const record = JSON.parse(raw) as OfflineRecord;
        if (record?.draft?.id) return record;
      }
    } catch {
      // 离线草稿损坏时忽略
    }
    return null;
  }

  private writeOfflineRecord(reason: OfflineRecord['reason'], draft: NoticeDraft = this.draft, baseRevision: number = this.baseRevision): void {
    this.offlineRecord = {
      packageId: this.activePackageId,
      baseRevision,
      draft: clone(draft),
      savedAt: new Date().toISOString(),
      reason
    };
    localStorage.setItem(this.offlineKey(this.activePackageId), JSON.stringify(this.offlineRecord));
    this.lastSavedAt = this.formatDateTime(new Date().toISOString());
  }

  private clearOfflineRecord(): void {
    localStorage.removeItem(this.offlineKey(this.activePackageId));
    this.offlineRecord = null;
  }

  private migrate(value: NoticeDraft): NoticeDraft | null {
    if (!value?.id || !Array.isArray(value.languages) || !Array.isArray(value.versions)) return null;
    value.discussions ??= [];
    value.reviews ??= defaultReviews();
    value.requiredLocales ??= ['zh-CN'];
    return value;
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
