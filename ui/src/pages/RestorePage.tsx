import { useEffect, useMemo, useState } from "react";
import { ArchiveRestore, CheckCircle2, Download, FileArchive, LoaderCircle, ShieldCheck, Upload } from "lucide-react";
import { api, type BackupOptions, type RestoreAnalysis } from "../api";
import { useDocumentTitle } from "../useDocumentTitle";
import { useI18n, type I18nKey } from "../i18n";
import { Alert, Badge, Button, ButtonAnchor, Checkbox, FileDropzone, Inline, PageHeader, SelectMenu, SettingRow, SettingsSection, Stack, Tabs } from "../components/ui";
import "./RestorePage.css";
import { appDayKey, formatAppDateTime } from "../dateTime";
import { emit } from "../events";

type RestoreTab = "export" | "restore";
type Mapping = { action: "create" | "merge" | "skip"; targetProfileId?: number };

const LABELS = {
  "instance.settings": "Instance appearance and settings",
  "instance.access-control": "Instance access control",
  "instance.plugins": "Enabled plugins and portable plugin settings",
  "instance.downloads": "Shared download settings",
  "instance.channels": "Shared channel names and download overrides",
  "profiles.index": "Profiles and avatars",
  "profile.avatar": "Profiles and avatars",
  "profile.settings": "Profile preferences",
  "profile.access-control": "Profile access control",
  "profile.downloads": "Profile download settings",
  "profile.subscriptions": "Subscriptions and channel overrides",
  "profile.followed-playlists": "Followed YouTube playlists",
  "profile.tags": "Tags and assignments",
  "profile.rules": "Automatic tag and filter rules",
  "profile.playlists": "Personal playlists and rules",
  "profile.video-state": "Queue, archive, likes and playback progress",
  "profile.history": "Watch history",
  "profile.bookmarks": "Video bookmarks and notes",
  "profile.discovery-feedback": "Discovery feedback",
  "profile.analytics": "Insights and Pulse history",
  "plugin.social.activity": "Social posts, comments and reactions",
  "library.referenced-videos": "Required referenced-video index",
} as const satisfies Record<string, I18nKey>;

const EXCLUSION_LABELS = {
  "authentication and passwords": "authentication and passwords",
  "passkeys and sessions": "passkeys and sessions",
  "download cookies, paths and media": "download cookies, paths and media",
  "network-derived caches": "network-derived caches",
} as const satisfies Record<string, I18nKey>;

function size(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function RestorePage({ showToast }: { showToast: (message: string) => void }) {
  const { t, locale, timeZone } = useI18n();
  const sectionLabel = (id: string) => {
    const key = LABELS[id as keyof typeof LABELS];
    return key ? t(key) : id;
  };
  const warningLabel = (warning: string) => {
    const unknown = warning.match(/^Unknown optional section (.+) will be skipped$/);
    if (unknown) return t("Unknown optional section {section} will be skipped", { section: unknown[1] });
    const newer = warning.match(/^Newer optional section (.+) will be skipped$/);
    if (newer) return t("Newer optional section {section} will be skipped", { section: newer[1] });
    const plugin = warning.match(/^Plugin (.+) is unavailable$/);
    if (plugin) return t("Plugin {plugin} is unavailable", { plugin: plugin[1] });
    if (warning === "Invalid access-control group skipped") return t("Invalid access-control group skipped");
    return warning;
  };
  const exclusionLabel = (value: string) => {
    const key = EXCLUSION_LABELS[value as keyof typeof EXCLUSION_LABELS];
    return key ? t(key) : value;
  };
  useDocumentTitle(t("Backup and restore"));
  const [tab, setTab] = useState<RestoreTab>("export");
  const [options, setOptions] = useState<BackupOptions | null>(null);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("setup");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<RestoreAnalysis | null>(null);
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [restoreSections, setRestoreSections] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<"merge" | "replace">("merge");
  const [dryRun, setDryRun] = useState<Awaited<ReturnType<typeof api.restorePlan>> | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.restoreCommit>> | null>(null);

  useEffect(() => {
    api.backupOptions().then((value) => {
      setOptions(value);
      setProfiles(value.profiles.map((profile) => profile.id));
      setSections(value.presets.setup ?? []);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const visibleSections = useMemo(() => options?.sections.filter((section) => section.category !== "dependency") ?? [], [options]);
  const selectPreset = (next: string) => {
    setPreset(next);
    if (next !== "custom" && options) setSections(options.presets[next] ?? []);
  };
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const exportArchive = async () => {
    if (!options || busy) return;
    setBusy(true);
    try {
      const blob = await api.exportBackup({ preset, profiles, sections });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `ytzero-backup-${appDayKey(new Date(), timeZone)}.zip`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const analyze = async (file: File) => {
    setBusy(true); setResult(null); setDryRun(null);
    try {
      const value = await api.restoreAnalyze(file);
      setAnalysis(value);
      setRestoreSections([...new Set(value.manifest.sections.map((section) => section.id))]);
      const next: Record<string, Mapping> = {};
      for (const source of value.manifest.profiles) {
        const same = value.existingProfiles.find((target) => target.portable_uuid === source.id);
        next[source.id] = same ? { action: "merge", targetProfileId: same.id } : { action: "create" };
      }
      setMappings(next);
    } catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const review = async () => {
    if (!analysis) return;
    setBusy(true);
    try { setDryRun(await api.restorePlan({ sessionId: analysis.sessionId, mappings, sections: restoreSections, strategy })); }
    catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!analysis || !dryRun) return;
    setBusy(true);
    try { setResult(await api.restoreCommit(analysis.sessionId, dryRun.planRevision)); emit("app-settings-changed"); setAnalysis(null); setDryRun(null); }
    catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  if (error) return <><PageHeader title={t("Backup and restore")} /><Alert variant="danger" title={t("Unavailable")}>{error}</Alert></>;
  return <div className="restore-page">
    <PageHeader title={t("Backup and restore")} description={t("Move selected configuration and personal data between YT Zero installations.")} icon={<ArchiveRestore />} />
    <Tabs value={tab} onChange={setTab} label={t("Backup operation")} options={[{ value: "export", label: t("Export backup"), icon: <Download /> }, { value: "restore", label: t("Restore backup"), icon: <Upload /> }]} />

    {tab === "export" && <Stack gap={4}>
      <SettingsSection title={t("What should the backup contain?")} description={t("Presets select categories; the manifest records the exact sections included.")}>
        <SettingRow label={t("Preset")} description={t("Setup and organization is the recommended portable backup.")}>
          <SelectMenu label={t("Backup preset")} value={preset} onChange={selectPreset} options={[{ value: "configuration", label: t("Configuration only") }, { value: "setup", label: t("Setup and organization") }, { value: "full", label: t("Full personal data") }, { value: "custom", label: t("Custom") }]} />
        </SettingRow>
        <div className="restore-options-grid">
          {visibleSections.map((section) => <Checkbox key={section.id} label={sectionLabel(section.id)} description={section.sensitivity === "personal" ? t("Personal data — opt in") : section.scope === "instance" ? t("Instance") : t("Per profile")} checked={sections.includes(section.id)} disabled={preset !== "custom"} onChange={() => setSections(toggle(sections, section.id))} />)}
        </div>
      </SettingsSection>
      <SettingsSection title={t("Profiles")}>
        <div className="restore-options-grid">{options?.profiles.map((profile) => <Checkbox key={profile.id} label={profile.name} description={profile.isChild ? t("Child profile") : t("Profile")} checked={profiles.includes(profile.id)} onChange={() => setProfiles(toggle(profiles, profile.id))} />)}</div>
      </SettingsSection>
      <Alert variant="info" title={t("Downloaded media is not included")}>{t("For exact disaster recovery, stop YT Zero and copy the complete data/ directory.")} <a href="https://github.com/Pelski/ytzero" target="_blank" rel="noreferrer">{t("Read the backup guide")}</a>.</Alert>
      <Inline justify="end"><Button variant="primary" leadingIcon={busy ? <LoaderCircle className="spin" /> : <Download />} disabled={busy || profiles.length === 0 || sections.length === 0} onClick={exportArchive}>{busy ? t("Creating backup…") : t("Download backup")}</Button></Inline>
    </Stack>}

    {tab === "restore" && <Stack gap={4}>
      {!analysis && !result && <SettingsSection title={t("Upload a portable backup")} description={t("The archive is checked and analyzed without changing application data.")}>
        <FileDropzone
          accept=".zip,.ytzero-backup"
          disabled={busy}
          icon={<FileArchive size={30} />}
          title={t("Drop a portable backup here")}
          description={t("Choose or drop a .zip or .ytzero-backup file.")}
          actionLabel={busy ? t("Analyzing…") : t("Choose backup")}
          actionIcon={busy ? <LoaderCircle className="spin" /> : <Upload />}
          onFiles={(files) => { if (files[0]) void analyze(files[0]); }}
        />
      </SettingsSection>}

      {analysis && !dryRun && <>
        <Alert variant="success" icon={<ShieldCheck />} title={t("Integrity verified")}>{t("Created")} {formatAppDateTime(analysis.manifest.createdAt, locale, timeZone)} — YT Zero {analysis.manifest.appVersion}, {size(analysis.archiveBytes)}.{analysis.sameSource ? t(" This backup came from this installation.") : ""}</Alert>
        {analysis.warnings.map((warning) => <Alert key={warning} variant="warning">{warningLabel(warning)}</Alert>)}
        <SettingsSection title={t("Profile destinations")} description={t("Create a profile, merge into an existing one, or skip it.")}>
          {analysis.manifest.profiles.map((source) => {
            const mapping = mappings[source.id] ?? { action: "skip" };
            const value = mapping.action === "merge" ? `merge:${mapping.targetProfileId}` : mapping.action;
            return <SettingRow key={source.id} label={source.name} description={source.isChild ? t("Child profile") : undefined}>
              <SelectMenu label={t("Destination for {name}", { name: source.name })} value={value} onChange={(next) => { if (next === "create" || next === "skip") setMappings({ ...mappings, [source.id]: { action: next } }); else setMappings({ ...mappings, [source.id]: { action: "merge", targetProfileId: Number(next.split(":")[1]) } }); }} options={[{ value: "create", label: t("Create new profile") }, ...analysis.existingProfiles.map((target) => ({ value: `merge:${target.id}`, label: t("Merge into {name}", { name: target.name }) })), { value: "skip", label: t("Skip") }]} />
            </SettingRow>;
          })}
        </SettingsSection>
        <SettingsSection title={t("Categories")}>
          <div className="restore-options-grid">{[...new Set(analysis.manifest.sections.map((section) => section.id))].filter((id) => id !== "library.referenced-videos").map((id) => <Checkbox key={id} label={sectionLabel(id)} checked={restoreSections.includes(id)} onChange={() => setRestoreSections(toggle(restoreSections, id))} />)}</div>
        </SettingsSection>
        <SettingsSection title={t("Conflict strategy")}>
          <SettingRow label={t("Apply selected categories")} description={strategy === "replace" ? t("Existing rows in each mapped profile/category are removed inside the restore transaction.") : t("Matching objects are updated and unrelated existing data is preserved.")}>
            <SelectMenu label={t("Conflict strategy")} value={strategy} onChange={setStrategy} options={[{ value: "merge", label: t("Merge safely") }, { value: "replace", label: t("Replace selected categories") }]} />
          </SettingRow>
          {strategy === "replace" && <Alert variant="danger" title={t("Destructive option")}>{t("Selected categories in mapped profiles will be replaced. An automatic database snapshot is created first.")}</Alert>}
        </SettingsSection>
        <Alert variant="info" title={t("Always excluded")}>{analysis.exclusions.map(exclusionLabel).join("; ")}. {t("Authentication remains unchanged.")}</Alert>
        <Inline justify="between"><Button onClick={() => { void api.deleteRestoreSession(analysis.sessionId); setAnalysis(null); }}>{t("Cancel")}</Button><Button variant="primary" disabled={busy || restoreSections.length === 0} onClick={review}>{busy ? t("Preparing review…") : t("Review changes")}</Button></Inline>
      </>}

      {analysis && dryRun && <SettingsSection title={t("Dry-run review")} description={t("Restore uses this exact parsed plan; it will not re-interpret your choices.")}>
        <div className="restore-summary">
          <Badge variant="success">{t("Create")} {dryRun.changes.createProfiles} {t("profiles")}</Badge>
          <Badge>{t("Update")} {dryRun.changes.mergeProfiles} {t("profiles")}</Badge>
          <Badge>{t("Apply")} {dryRun.changes.records.toLocaleString(locale)} {t("records")}</Badge>
          {dryRun.changes.skipProfiles > 0 && <Badge variant="warning">{t("Skip")} {dryRun.changes.skipProfiles} {t("profiles")}</Badge>}
        </div>
        {dryRun.warnings.map((warning) => <Alert key={warning} variant="warning">{warningLabel(warning)}</Alert>)}
        <Inline justify="between"><Button onClick={() => setDryRun(null)}>{t("Back")}</Button><Button variant={strategy === "replace" ? "danger" : "primary"} disabled={busy} onClick={commit}>{busy ? t("Restoring…") : t("Restore backup")}</Button></Inline>
      </SettingsSection>}

      {result && <SettingsSection title={t("Restore complete")}>
        <Alert variant="success" icon={<CheckCircle2 />} title={t("Backup restored")}>{t("Created")} {result.counts.created}, {t("updated")} {result.counts.updated}, {t("skipped")} {result.counts.skipped}. {t("An automatic pre-restore database snapshot was saved.")}</Alert>
        {result.counts.warnings.map((warning) => <Alert key={warning} variant="warning">{warningLabel(warning)}</Alert>)}
        <Inline><Button onClick={() => setResult(null)}>{t("Restore another backup")}</Button><ButtonAnchor href="/" variant="primary">{t("Return to YT Zero")}</ButtonAnchor></Inline>
      </SettingsSection>}
    </Stack>}
  </div>;
}
