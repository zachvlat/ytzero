const { api } = await import("../src/routes");
const { db } = await import("../src/db");

const secondary = db.prepare(
  "INSERT INTO users(name, avatar_color, sort_order, portable_uuid) VALUES(?, ?, ?, ?) RETURNING id",
).get("Secondary", "#7c5cff", 1, crypto.randomUUID()) as { id: number };
const staleAdmin = db.prepare(
  "INSERT INTO users(name, avatar_color, sort_order, portable_uuid, is_admin) VALUES(?, ?, ?, ?, 1) RETURNING id",
).get("Stale admin", "#5cbf86", 2, crypto.randomUUID()) as { id: number };

async function request(profileId: number, path: string, method = "GET", body?: unknown, extraCookie = "") {
  const cookie = [`ytzero_profile=${profileId}`, extraCookie].filter(Boolean).join("; ");
  return api.request(`http://localhost${path}`, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const enableResponse = await request(1, "/child-lock/enable", "POST", { pin: "123456" });
const adminStatus = await (await request(1, "/child-lock")).json() as any;
const secondaryStatus = await (await request(secondary.id, "/child-lock")).json() as any;
const defaultPermissions = await (await request(secondary.id, "/profile-permissions")).json() as any;

const adminSettings = await request(1, "/settings", "PUT", { show_shorts: "1" });
const restrictedSettings = await request(secondary.id, "/settings", "PUT", { show_shorts: "1" });
const defaultTag = await request(secondary.id, "/tags", "POST", { name: "Allowed", color: "#123456" });
const restrictedImport = await request(secondary.id, "/import/analyze", "POST", {});

const unlockResponse = await request(secondary.id, "/child-lock/unlock", "POST", { pin: "123456" });
const unlockCookie = (unlockResponse.headers.get("set-cookie") ?? "").split(";", 1)[0];
const restrictedAfterPin = await request(secondary.id, "/settings", "PUT", { show_shorts: "1" }, unlockCookie);

const snapshot = await (await request(1, "/access-control")).json() as any;
const primaryAccess = snapshot.profiles.find((profile: any) => profile.id === 1);
const secondaryAccess = snapshot.profiles.find((profile: any) => profile.id === secondary.id).access;
const reorderedGroupIds = snapshot.groups.map((group: any) => group.id).reverse();
const reorderResponse = await request(1, "/access-control/group-order", "PUT", { group_ids: reorderedGroupIds });
const reorderedSnapshot = await reorderResponse.json() as any;
const revokeAdminResponse = await request(1, `/profiles/${staleAdmin.id}/admin`, "PUT", { is_admin: false });
const revokedAdmin = await revokeAdminResponse.json() as any;
const createRoleResponse = await request(1, "/access-control/groups", "POST", { name: "Temporary role", permissions: ["channels"] });
const createdRoleSnapshot = await createRoleResponse.json() as any;
const temporaryRole = createdRoleSnapshot.groups.find((group: any) => group.name === "Temporary role");
const assignTemporaryRoleResponse = await request(1, `/access-control/profiles/${staleAdmin.id}`, "PUT", { group_id: temporaryRole.id, overrides: {} });
const deleteRoleResponse = await request(1, `/access-control/groups/${temporaryRole.id}?replacement_group_id=${createdRoleSnapshot.default_group_id}`, "DELETE");
const afterRoleDelete = await (await request(1, "/access-control")).json() as any;
const protectedSystemRole = snapshot.groups.find((group: any) => group.is_system && group.id !== snapshot.default_group_id);
const deleteSystemRoleResponse = await request(1, `/access-control/groups/${protectedSystemRole.id}?replacement_group_id=${snapshot.default_group_id}`, "DELETE");
const createDefaultRoleResponse = await request(1, "/access-control/groups", "POST", { name: "Temporary default", permissions: [] });
const defaultRoleCandidate = (await createDefaultRoleResponse.json() as any).groups.find((group: any) => group.name === "Temporary default");
const setTemporaryDefaultResponse = await request(1, "/access-control/default-group", "PUT", { group_id: defaultRoleCandidate.id });
const deleteDefaultRoleResponse = await request(1, `/access-control/groups/${defaultRoleCandidate.id}?replacement_group_id=${snapshot.default_group_id}`, "DELETE");
const deletedDefaultRoleSnapshot = await deleteDefaultRoleResponse.json() as any;
const policyResponse = await request(1, `/access-control/profiles/${secondary.id}`, "PUT", { group_id: secondaryAccess.group_id, overrides: { playlists: "deny", followed_playlists: "deny", playback: "deny" } });
const policy = await policyResponse.json() as any;
const pinLockedSettings = await request(secondary.id, "/settings", "PUT", { show_shorts: "0" });
const delegatedSettings = await request(secondary.id, "/settings", "PUT", { show_shorts: "0" }, unlockCookie);
const restrictedPlayback = await request(secondary.id, "/settings", "PUT", { player_speed: "1.5" }, unlockCookie);
const restrictedPlaylist = await request(secondary.id, "/playlists", "POST", { name: "Blocked" }, unlockCookie);
const restrictedFollowedPlaylist = await request(secondary.id, "/channel-playlists/PLblocked/follow", "PUT", { followed: true }, unlockCookie);
const delegatedProfile = await request(secondary.id, `/profiles/${secondary.id}`, "PATCH", { name: "Renamed" }, unlockCookie);
const forbiddenPolicy = await request(secondary.id, "/access-control/profiles/1", "PUT", { group_id: secondaryAccess.group_id }, unlockCookie);

const forbiddenLogs = await request(secondary.id, "/logs");
const forbiddenExternal = await request(secondary.id, "/external");
const forbiddenVersion = await request(secondary.id, "/version");
const forbiddenUpdateCheck = await request(secondary.id, "/updates/check", "POST", {});
const forbiddenUpdateInterval = await request(secondary.id, "/settings", "PUT", { update_check_interval: "daily" }, unlockCookie);
const forbiddenBackup = await request(secondary.id, "/backup/options");
const adminLogs = await request(1, "/logs");
const changedPin = await request(1, "/child-lock/change-pin", "POST", { new_pin: "654321" });
const disabled = await request(1, "/child-lock/disable", "POST", {});

console.log("RESULT " + JSON.stringify({
  enableStatus: enableResponse.status,
  adminLocked: adminStatus.child_lock.locked,
  secondaryLocked: secondaryStatus.child_lock.locked,
  defaultAreas: defaultPermissions.permissions.admin_only_areas,
  primaryAccessIsPrimary: primaryAccess.is_primary,
  primaryAccessIsAdmin: primaryAccess.is_admin,
  reorderStatus: reorderResponse.status,
  reorderedGroupIds: reorderedSnapshot.groups.map((group: any) => group.id),
  expectedReorderedGroupIds: reorderedGroupIds,
  revokeAdminStatus: revokeAdminResponse.status,
  revokedAdminIsAdmin: revokedAdmin.profile.is_admin,
  createRoleStatus: createRoleResponse.status,
  assignTemporaryRoleStatus: assignTemporaryRoleResponse.status,
  deleteRoleStatus: deleteRoleResponse.status,
  deletedRoleMissing: !afterRoleDelete.groups.some((group: any) => group.id === temporaryRole.id),
  reassignedToDefaultRole: afterRoleDelete.profiles.find((profile: any) => profile.id === staleAdmin.id).access.group_id === createdRoleSnapshot.default_group_id,
  deleteSystemRoleStatus: deleteSystemRoleResponse.status,
  setTemporaryDefaultStatus: setTemporaryDefaultResponse.status,
  deleteDefaultRoleStatus: deleteDefaultRoleResponse.status,
  defaultRoleAfterDelete: deletedDefaultRoleSnapshot.default_group_id,
  expectedDefaultRoleAfterDelete: snapshot.default_group_id,
  adminSettingsStatus: adminSettings.status,
  restrictedSettingsStatus: restrictedSettings.status,
  defaultTagStatus: defaultTag.status,
  restrictedImportStatus: restrictedImport.status,
  unlockStatus: unlockResponse.status,
  restrictedAfterPinStatus: restrictedAfterPin.status,
  policyStatus: policyResponse.status,
  policyAreas: policy.access.admin_only_areas,
  pinLockedSettingsStatus: pinLockedSettings.status,
  delegatedSettingsStatus: delegatedSettings.status,
  restrictedPlaybackStatus: restrictedPlayback.status,
  restrictedPlaylistStatus: restrictedPlaylist.status,
  restrictedFollowedPlaylistStatus: restrictedFollowedPlaylist.status,
  delegatedProfileStatus: delegatedProfile.status,
  forbiddenPolicyStatus: forbiddenPolicy.status,
  forbiddenLogsStatus: forbiddenLogs.status,
  forbiddenExternalStatus: forbiddenExternal.status,
  forbiddenVersionStatus: forbiddenVersion.status,
  forbiddenUpdateCheckStatus: forbiddenUpdateCheck.status,
  forbiddenUpdateIntervalStatus: forbiddenUpdateInterval.status,
  forbiddenBackupStatus: forbiddenBackup.status,
  adminLogsStatus: adminLogs.status,
  changedPinStatus: changedPin.status,
  disabledStatus: disabled.status,
}));

db.close();
