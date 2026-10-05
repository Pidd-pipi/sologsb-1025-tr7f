// 发布包领域模型与并发合并逻辑。
// 通知草稿、语言版本、角色确认和锁定动作统一存放在带基线（revision）的发布包中；
// 多窗口共享同一份包，陈旧窗口基于基线做三方合并，重叠修改停在待处理状态。

export type ReviewStatus = 'pending' | 'approved' | 'changes';
export type NoticeStatus = 'draft' | 'in-review' | 'locked';

export interface LanguageVersion {
  id: string;
  locale: string;
  name: string;
  title: string;
  body: string;
  translator: string;
  reviewed: boolean;
}

export interface Discussion {
  id: string;
  languageId: string;
  sentenceIndex: number;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export interface RoleReview {
  role: '编辑' | '法务' | '翻译' | '发布人';
  owner: string;
  status: ReviewStatus;
  note: string;
  /** 确认时的内容签名；语言正文等内容变化后签名失配，确认立即失效。 */
  signature?: string;
}

export interface VersionSnapshot {
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

export interface NoticeDraft {
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

export interface LockAction {
  id: string;
  action: 'lock' | 'emergency-revision';
  version: string;
  at: string;
  by: string;
}

/** 带基线的发布包：revision 每次写入递增，是并发控制的基准。 */
export interface ReleasePackage {
  id: string;
  revision: number;
  notice: NoticeDraft;
  locks: LockAction[];
  updatedAt: string;
  updatedBy: string;
}

/** 某个窗口最后一次同步到的包内容（三方合并的公共祖先）。 */
export interface PackageBaseline {
  revision: number;
  notice: NoticeDraft;
  locks: LockAction[];
}

/** 陈旧/离线窗口保留在本机的草稿，合并完成前不会丢失。 */
export interface OfflineEntry {
  baseRevision: number;
  notice: NoticeDraft;
  locks: LockAction[];
  draft: NoticeDraft;
  draftLocks: LockAction[];
  savedAt: string;
}

export type ConflictKind = 'meta' | 'list' | 'language-field' | 'language-presence' | 'review' | 'discussion';

export interface ConflictItem {
  id: string;
  kind: ConflictKind;
  label: string;
  field?: string;
  languageId?: string;
  role?: string;
  discussionId?: string;
  oursValue: unknown;
  theirsValue: unknown;
  oursText: string;
  theirsText: string;
  resolution?: 'ours' | 'theirs';
}

export interface MergeOutcome {
  merged: NoticeDraft;
  conflicts: ConflictItem[];
  /** 自动并入的对方修改处数（双方没碰同一处的内容）。 */
  autoMerged: number;
  /** 被拒绝并入的内容说明（如语言版本超限）。 */
  refused: string[];
}

export interface MergeState {
  baseRevision: number;
  storedRevision: number;
  theirs: PackageBaseline;
  conflicts: ConflictItem[];
  autoMerged: number;
  refused: string[];
}

export const MAX_LANGUAGES = 8;
export const PACKAGE_INDEX_KEY = 'sologsb-1025-packages-v2:index';
export const LEGACY_STORAGE_KEY = 'sologsb-1025-emergency-notice-v1';
export const packageKey = (id: string): string => `sologsb-1025-packages-v2:${id}`;
export const offlineKey = (id: string): string => `sologsb-1025-packages-v2:${id}:offline`;

export const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

export const deepEqual = <T>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);

export function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const STATUS_LABELS: Record<NoticeStatus, string> = { draft: '草稿', 'in-review': '审阅中', locked: '已锁定' };
const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = { pending: '待审阅', approved: '已确认', changes: '需修改' };

/** 内容签名：语言正文、元信息、渠道与必需语言变化即改变，用于让角色确认立即失效。 */
export function contentSignature(notice: NoticeDraft): string {
  const payload = JSON.stringify({
    title: notice.title,
    eventType: notice.eventType,
    severity: notice.severity,
    scope: notice.scope,
    channels: notice.channels,
    eventAt: notice.eventAt,
    effectiveAt: notice.effectiveAt,
    expiresAt: notice.expiresAt,
    requiredLocales: notice.requiredLocales,
    languages: notice.languages.map((language) => [
      language.id, language.title, language.body, language.translator, language.reviewed
    ])
  });
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) hash = ((hash << 5) + hash + payload.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/** 冲突项展示文本。 */
export function conflictText(value: unknown): string {
  if (value === null || value === undefined) return '（空 / 已删除）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value ? (value.length > 90 ? `${value.slice(0, 90)}…` : value) : '（空）';
  if (Array.isArray(value)) return value.length ? value.join('、') : '（空）';
  const record = value as Record<string, unknown>;
  if ('role' in record && 'status' in record) {
    const status = REVIEW_STATUS_LABELS[record['status'] as ReviewStatus] ?? String(record['status']);
    return `状态：${status}${record['note'] ? ` · 备注：${String(record['note'])}` : ''}`;
  }
  if ('locale' in record && 'body' in record) {
    return `《${String(record['title'] || '未命名')}》${String(record['body']).slice(0, 60)}`;
  }
  if ('text' in record && 'sentenceIndex' in record) {
    return `第${Number(record['sentenceIndex']) + 1}句 · ${record['resolved'] ? '已解决' : '未解决'} · ${String(record['text'])}`;
  }
  return JSON.stringify(value);
}

interface ThreeWay<T> {
  value: T;
  conflict: boolean;
  /** 结果为对方版本（我方未动，对方改了）。 */
  fromTheirs: boolean;
}

function threeWay<T>(base: T, ours: T, theirs: T, equal: (a: T, b: T) => boolean): ThreeWay<T> {
  if (equal(ours, theirs)) return { value: ours, conflict: false, fromTheirs: false };
  if (equal(ours, base)) return { value: theirs, conflict: false, fromTheirs: true };
  if (equal(theirs, base)) return { value: ours, conflict: false, fromTheirs: false };
  return { value: ours, conflict: true, fromTheirs: false };
}

const eqValue = <T>(a: T, b: T): boolean => a === b;

function mergeStringList(base: string[], ours: string[], theirs: string[]): { value: string[]; conflict: boolean; fromTheirs: boolean } {
  if (deepEqual(ours, theirs)) return { value: [...ours], conflict: false, fromTheirs: false };
  if (deepEqual(ours, base)) return { value: [...theirs], conflict: false, fromTheirs: true };
  if (deepEqual(theirs, base)) return { value: [...ours], conflict: false, fromTheirs: false };
  const ourAdd = ours.filter((item) => !base.includes(item));
  const ourDel = base.filter((item) => !ours.includes(item));
  const theirAdd = theirs.filter((item) => !base.includes(item));
  const theirDel = base.filter((item) => !theirs.includes(item));
  const overlapped =
    ourAdd.some((item) => theirDel.includes(item)) || theirAdd.some((item) => ourDel.includes(item));
  if (overlapped) return { value: [...ours], conflict: true, fromTheirs: false };
  const merged = [...base, ...ourAdd, ...theirAdd].filter(
    (item) => !ourDel.includes(item) && !theirDel.includes(item)
  );
  return { value: [...new Set(merged)], conflict: false, fromTheirs: true };
}

type MetaKey = 'title' | 'eventType' | 'severity' | 'scope' | 'eventAt' | 'effectiveAt' | 'expiresAt' | 'version' | 'lockedAt' | 'emergencyRevision';

const META_FIELDS: Array<{ key: MetaKey; label: string }> = [
  { key: 'title', label: '通知标题' },
  { key: 'eventType', label: '事件类型' },
  { key: 'severity', label: '严重程度' },
  { key: 'scope', label: '影响范围' },
  { key: 'eventAt', label: '事件时间' },
  { key: 'effectiveAt', label: '生效时间' },
  { key: 'expiresAt', label: '失效时间' },
  { key: 'version', label: '版本号' },
  { key: 'lockedAt', label: '锁定时间' },
  { key: 'emergencyRevision', label: '紧急修订标记' }
];

const LANGUAGE_FIELDS: Array<{ key: 'title' | 'body' | 'translator' | 'reviewed'; label: string }> = [
  { key: 'title', label: '标题' },
  { key: 'body', label: '正文' },
  { key: 'translator', label: '译者' },
  { key: 'reviewed', label: '复核状态' }
];

/**
 * 三方合并：base 为双方共同的基线，ours/theirs 为两边各自的修改。
 * 只有一方碰过的内容直接合并；双方都改过的重叠部分生成待处理冲突（默认暂取我方值）。
 */
export function mergeNotices(base: NoticeDraft, ours: NoticeDraft, theirs: NoticeDraft): MergeOutcome {
  const conflicts: ConflictItem[] = [];
  const refused: string[] = [];
  let autoMerged = 0;
  const merged = clone(ours);

  META_FIELDS.forEach((field) => {
    const result = threeWay(base[field.key], ours[field.key], theirs[field.key], eqValue);
    if (result.conflict) {
      conflicts.push({
        id: uid('conflict'), kind: 'meta', label: field.label, field: field.key,
        oursValue: clone(ours[field.key]), theirsValue: clone(theirs[field.key]),
        oursText: conflictText(ours[field.key]), theirsText: conflictText(theirs[field.key])
      });
    } else {
      (merged as unknown as Record<string, unknown>)[field.key] = result.value;
      if (result.fromTheirs) autoMerged++;
    }
  });

  const statusResult = threeWay(base.status, ours.status, theirs.status, eqValue);
  if (statusResult.conflict) {
    conflicts.push({
      id: uid('conflict'), kind: 'meta', label: '发布状态', field: 'status',
      oursValue: ours.status, theirsValue: theirs.status,
      oursText: STATUS_LABELS[ours.status], theirsText: STATUS_LABELS[theirs.status]
    });
  } else {
    merged.status = statusResult.value;
    if (statusResult.fromTheirs) autoMerged++;
  }

  (['channels', 'requiredLocales'] as const).forEach((key) => {
    const label = key === 'channels' ? '目标渠道' : '必需语言';
    const result = mergeStringList(base[key], ours[key], theirs[key]);
    if (result.conflict) {
      conflicts.push({
        id: uid('conflict'), kind: 'list', label, field: key,
        oursValue: [...ours[key]], theirsValue: [...theirs[key]],
        oursText: conflictText(ours[key]), theirsText: conflictText(theirs[key])
      });
    } else {
      merged[key] = result.value;
      if (result.fromTheirs) autoMerged++;
    }
  });

  merged.languages = mergeLanguages(base, ours, theirs, conflicts, refused, () => autoMerged++);
  merged.discussions = mergeDiscussions(base, ours, theirs, conflicts, () => autoMerged++);
  merged.reviews = mergeReviews(base, ours, theirs, conflicts, () => autoMerged++);

  const versionMap = new Map<string, VersionSnapshot>();
  [...base.versions, ...theirs.versions, ...ours.versions].forEach((version) => {
    if (!versionMap.has(version.id)) versionMap.set(version.id, clone(version));
  });
  merged.versions = [...versionMap.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  merged.updatedAt = new Date().toISOString();
  return { merged, conflicts, autoMerged, refused };
}

function mergeLanguages(
  base: NoticeDraft,
  ours: NoticeDraft,
  theirs: NoticeDraft,
  conflicts: ConflictItem[],
  refused: string[],
  countAuto: () => void
): LanguageVersion[] {
  const baseById = new Map(base.languages.map((language) => [language.id, language]));
  const ourById = new Map(ours.languages.map((language) => [language.id, language]));
  const theirById = new Map(theirs.languages.map((language) => [language.id, language]));
  const ids: string[] = [];
  [...base.languages, ...ours.languages, ...theirs.languages].forEach((language) => {
    if (!ids.includes(language.id)) ids.push(language.id);
  });

  const languages: LanguageVersion[] = [];
  ids.forEach((id) => {
    const b = baseById.get(id);
    const o = ourById.get(id);
    const t = theirById.get(id);
    const name = (o ?? t ?? b)?.name ?? id;
    if (b && o && t) {
      const language = clone(o);
      LANGUAGE_FIELDS.forEach((field) => {
        const result = threeWay(b[field.key], o[field.key], t[field.key], eqValue);
        if (result.conflict) {
          conflicts.push({
            id: uid('conflict'), kind: 'language-field', label: `语言「${name}」· ${field.label}`,
            languageId: id, field: field.key,
            oursValue: clone(o[field.key]), theirsValue: clone(t[field.key]),
            oursText: conflictText(o[field.key]), theirsText: conflictText(t[field.key])
          });
        } else {
          (language as unknown as Record<string, unknown>)[field.key] = result.value;
          if (result.fromTheirs) countAuto();
        }
      });
      languages.push(language);
    } else if (o && t && !b) {
      if (deepEqual(o, t)) {
        languages.push(clone(o));
      } else {
        conflicts.push({
          id: uid('conflict'), kind: 'language-presence', label: `语言「${name}」· 双方均新增且内容不同`,
          languageId: id, oursValue: clone(o), theirsValue: clone(t),
          oursText: conflictText(o), theirsText: conflictText(t)
        });
        languages.push(clone(o));
      }
    } else if (o && !t) {
      if (!b) {
        languages.push(clone(o));
      } else if (deepEqual(o, b)) {
        countAuto(); // 对方删除、我方未动 → 跟随删除
      } else {
        conflicts.push({
          id: uid('conflict'), kind: 'language-presence', label: `语言「${name}」· 对方删除但我方已修改`,
          languageId: id, oursValue: clone(o), theirsValue: null,
          oursText: conflictText(o), theirsText: conflictText(null)
        });
        languages.push(clone(o));
      }
    } else if (!o && t) {
      if (!b) {
        languages.push(clone(t)); // 对方新增 → 并入
        countAuto();
      } else if (deepEqual(t, b)) {
        // 我方删除、对方未动 → 跟随删除
      } else {
        conflicts.push({
          id: uid('conflict'), kind: 'language-presence', label: `语言「${name}」· 我方删除但对方已修改`,
          languageId: id, oursValue: null, theirsValue: clone(t),
          oursText: conflictText(null), theirsText: conflictText(t)
        });
        languages.push(clone(t));
      }
    }
  });

  if (languages.length > MAX_LANGUAGES) {
    const own = languages.filter((language) => ourById.has(language.id) || baseById.has(language.id));
    const incoming = languages.filter((language) => !ourById.has(language.id) && !baseById.has(language.id));
    const kept = [...own, ...incoming.slice(0, Math.max(0, MAX_LANGUAGES - own.length))];
    const dropped = [...incoming.slice(Math.max(0, MAX_LANGUAGES - own.length)), ...kept.splice(MAX_LANGUAGES)];
    if (dropped.length) {
      refused.push(`语言版本超过 ${MAX_LANGUAGES} 个，已拒绝并入：${dropped.map((language) => language.name).join('、')}。`);
    }
    return kept;
  }
  return languages;
}

function mergeDiscussions(
  base: NoticeDraft,
  ours: NoticeDraft,
  theirs: NoticeDraft,
  conflicts: ConflictItem[],
  countAuto: () => void
): Discussion[] {
  const baseById = new Map(base.discussions.map((discussion) => [discussion.id, discussion]));
  const ourById = new Map(ours.discussions.map((discussion) => [discussion.id, discussion]));
  const theirById = new Map(theirs.discussions.map((discussion) => [discussion.id, discussion]));
  const ids: string[] = [];
  [...base.discussions, ...ours.discussions, ...theirs.discussions].forEach((discussion) => {
    if (!ids.includes(discussion.id)) ids.push(discussion.id);
  });

  const discussions: Discussion[] = [];
  ids.forEach((id) => {
    const b = baseById.get(id);
    const o = ourById.get(id);
    const t = theirById.get(id);
    if (o && t) {
      if (!b) {
        discussions.push(clone(o));
        return;
      }
      const result = threeWay(b, o, t, deepEqual);
      if (result.conflict) {
        conflicts.push({
          id: uid('conflict'), kind: 'discussion', label: `讨论 · ${o.text.slice(0, 24)}`,
          discussionId: id, oursValue: clone(o), theirsValue: clone(t),
          oursText: conflictText(o), theirsText: conflictText(t)
        });
        discussions.push(clone(o));
      } else {
        discussions.push(clone(result.value));
        if (result.fromTheirs) countAuto();
      }
    } else if (o && !t) {
      if (!b) discussions.push(clone(o));
      else if (deepEqual(o, b)) countAuto(); // 对方删除、我方未动
      else {
        conflicts.push({
          id: uid('conflict'), kind: 'discussion', label: `讨论 · ${o.text.slice(0, 24)}（对方已删除）`,
          discussionId: id, oursValue: clone(o), theirsValue: null,
          oursText: conflictText(o), theirsText: conflictText(null)
        });
        discussions.push(clone(o));
      }
    } else if (!o && t) {
      if (!b) {
        discussions.push(clone(t));
        countAuto();
      } else if (!deepEqual(t, b)) {
        conflicts.push({
          id: uid('conflict'), kind: 'discussion', label: `讨论 · ${t.text.slice(0, 24)}（我方已删除）`,
          discussionId: id, oursValue: null, theirsValue: clone(t),
          oursText: conflictText(null), theirsText: conflictText(t)
        });
        discussions.push(clone(t));
      }
    }
  });
  return discussions;
}

function mergeReviews(
  base: NoticeDraft,
  ours: NoticeDraft,
  theirs: NoticeDraft,
  conflicts: ConflictItem[],
  countAuto: () => void
): RoleReview[] {
  const baseByRole = new Map(base.reviews.map((review) => [review.role, review]));
  const ourByRole = new Map(ours.reviews.map((review) => [review.role, review]));
  const theirByRole = new Map(theirs.reviews.map((review) => [review.role, review]));
  const roles: Array<RoleReview['role']> = [];
  [...ours.reviews, ...theirs.reviews, ...base.reviews].forEach((review) => {
    if (!roles.includes(review.role)) roles.push(review.role);
  });

  const reviews: RoleReview[] = [];
  roles.forEach((role) => {
    const b = baseByRole.get(role);
    const o = ourByRole.get(role);
    const t = theirByRole.get(role);
    if (o && t) {
      if (!b) {
        reviews.push(clone(o));
        return;
      }
      const result = threeWay(b, o, t, deepEqual);
      if (result.conflict) {
        conflicts.push({
          id: uid('conflict'), kind: 'review', label: `角色确认 · ${role}`, role,
          oursValue: clone(o), theirsValue: clone(t),
          oursText: conflictText(o), theirsText: conflictText(t)
        });
        reviews.push(clone(o));
      } else {
        reviews.push(clone(result.value));
        if (result.fromTheirs) countAuto();
      }
    } else if (o) {
      reviews.push(clone(o));
    } else if (t) {
      reviews.push(clone(t));
      if (!b || !deepEqual(t, b)) countAuto();
    }
  });
  return reviews;
}

/** 锁定动作按 id 求并集，双方各自的冻结/紧急修订记录都保留。 */
export function mergeLocks(base: LockAction[], ours: LockAction[], theirs: LockAction[]): LockAction[] {
  const map = new Map<string, LockAction>();
  [...base, ...theirs, ...ours].forEach((lock) => {
    if (!map.has(lock.id)) map.set(lock.id, clone(lock));
  });
  return [...map.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/** 旧数据升级：校验并补齐字段，为已确认角色补上内容签名。 */
export function migrateNotice(value: unknown): NoticeDraft | null {
  const notice = value as NoticeDraft | null;
  if (!notice || !notice.id || !Array.isArray(notice.languages) || !Array.isArray(notice.versions)) return null;
  notice.discussions ??= [];
  notice.reviews ??= [];
  notice.requiredLocales ??= ['zh-CN'];
  notice.channels ??= [];
  notice.status ??= 'draft';
  notice.version ??= '1.0.0';
  notice.emergencyRevision ??= false;
  notice.updatedAt ??= new Date().toISOString();
  const signature = contentSignature(notice);
  notice.reviews.forEach((review) => {
    if (review.status === 'approved' && !review.signature) review.signature = signature;
  });
  return notice;
}

/** 从旧数据推导锁定动作记录。 */
export function deriveLocks(notice: NoticeDraft): LockAction[] {
  const locks: LockAction[] = [];
  if (notice.emergencyRevision) {
    locks.push({ id: uid('lock'), action: 'emergency-revision', version: notice.version, at: notice.updatedAt, by: '历史数据' });
  }
  if (notice.status === 'locked') {
    locks.push({ id: uid('lock'), action: 'lock', version: notice.version, at: notice.lockedAt ?? notice.updatedAt, by: '历史数据' });
  }
  return locks;
}
