/**
 * FGA Mount Action
 * Adds token HUD buttons to D&D 5e Group and Vehicle tokens.
 * A Vehicle's "crew" is a roster the GM sets with the Manage Crew button (stored in a flag),
 * since Vehicle actors have no built-in member list like Group actors do.
 * Players cannot create tokens, so their requests go to an active GM by socket.
 */
const ID = "fga-mount-action";
const SOCKET = `module.${ID}`;

/* ---------- helpers ---------- */

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const radiusFeet = () => Number(game.settings.get(ID, "radius")) || 10;

/** A Group or Vehicle token can carry members. */
function isCarrier(actor) {
  return actor?.type === "group" || actor?.type === "vehicle";
}

/** Actors that are members of a Group actor, or crew of a Vehicle actor. */
function getMembers(carrierActor) {
  if (carrierActor?.type === "vehicle") {
    const ids = carrierActor.getFlag(ID, "crew") ?? [];
    return ids.map(id => game.actors.get(id)).filter(a => a && a.id !== carrierActor.id);
  }
  const list = carrierActor?.system?.members ?? [];
  const out = [];
  for (const entry of list) {
    const actor = entry?.actor ?? entry;
    if (actor?.documentName === "Actor" && actor.id !== carrierActor.id && !out.includes(actor)) out.push(actor);
  }
  return out;
}

/** GM-only: edit a Vehicle's crew roster. */
async function manageCrew(vehicleActor) {
  const current = new Set(vehicleActor.getFlag(ID, "crew") ?? []);
  const choices = game.actors
    .filter(a => a.id !== vehicleActor.id && !isCarrier(a))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(a => `<label style="display:block;margin:2px 0;"><input type="checkbox" name="fgamga-crew" value="${a.id}" ${current.has(a.id) ? "checked" : ""}> ${a.name}</label>`)
    .join("");
  const content = `<div style="max-height:300px;overflow:auto;">${choices || t("FGAMGA.Crew.None")}</div>`;
  new Dialog({
    title: t("FGAMGA.Crew.Title", { name: vehicleActor.name }),
    content,
    buttons: {
      save: {
        icon: '<i class="fa-solid fa-check"></i>',
        label: t("FGAMGA.Crew.Save"),
        callback: html => {
          const root = html instanceof HTMLElement ? html : html[0];
          const ids = Array.from(root.querySelectorAll('input[name="fgamga-crew"]:checked')).map(i => i.value);
          vehicleActor.setFlag(ID, "crew", ids);
        }
      }
    },
    default: "save"
  }).render(true);
}

/** Members this user controls: owned, or their default Player Character. */
function userMembers(members, user) {
  return members.filter(a => a.testUserPermission(user, "OWNER") || user.character?.id === a.id);
}

/** Tokens on the scene for one actor. */
function tokensFor(scene, actor) {
  return scene.tokens.filter(tok => tok.actorId === actor.id);
}

function tokenCenter(tokDoc) {
  const g = tokDoc.parent.grid;
  return {
    x: tokDoc.x + (tokDoc.width * g.size) / 2,
    y: tokDoc.y + (tokDoc.height * g.size) / 2
  };
}

/** Edge to edge distance in scene units (0 when touching or overlapping). */
function distanceBetween(scene, a, b) {
  const g = scene.grid;
  const ra = { x: a.x, y: a.y, w: a.width * g.size, h: a.height * g.size };
  const rb = { x: b.x, y: b.y, w: b.width * g.size, h: b.height * g.size };
  const dx = Math.max(ra.x - (rb.x + rb.w), rb.x - (ra.x + ra.w), 0);
  const dy = Math.max(ra.y - (rb.y + rb.h), rb.y - (ra.y + ra.h), 0);
  return (Math.hypot(dx, dy) / g.size) * g.distance;
}

function isWithin(scene, a, b) {
  return distanceBetween(scene, a, b) <= radiusFeet() + 0.01;
}

/* ---------- placement ---------- */

/** Pick a free random spot near the group token. Returns {x, y} top left, or null. */
function findSpot(scene, groupTok, actor, taken) {
  const grid = scene.grid;
  const size = grid.size;
  const tw = (actor.prototypeToken?.width ?? 1) * size;
  const th = (actor.prototypeToken?.height ?? 1) * size;
  const c = tokenCenter(groupTok);
  const radiusPx = (radiusFeet() / grid.distance) * size;
  const gx = groupTok.x, gy = groupTok.y;
  const gw = groupTok.width * size, gh = groupTok.height * size;
  const rect = scene.dimensions.sceneRect;
  const others = scene.tokens.map(tok => ({
    x: tok.x, y: tok.y, w: tok.width * size, h: tok.height * size
  })).concat(taken);

  for (let i = 0; i < 120; i++) {
    // random point in the group's box grown by the range
    const cx0 = gx - radiusPx + Math.random() * (gw + radiusPx * 2);
    const cy0 = gy - radiusPx + Math.random() * (gh + radiusPx * 2);
    let px = cx0 - tw / 2;
    let py = cy0 - th / 2;
    try {
      const snapped = canvas.grid.getSnappedPoint({ x: px, y: py }, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX });
      px = snapped.x; py = snapped.y;
    } catch (e) { /* gridless: keep raw point */ }

    const cx = px + tw / 2, cy = py + th / 2;
    // stay inside the scene
    if (px < rect.x || py < rect.y || px + tw > rect.x + rect.width || py + th > rect.y + rect.height) continue;
    // stay within range of the group token edge
    const dx = Math.max(gx - (px + tw), px - (gx + gw), 0);
    const dy = Math.max(gy - (py + th), py - (gy + gh), 0);
    if (Math.hypot(dx, dy) > radiusPx + 0.5) continue;
    // no overlap with other tokens
    const hit = others.some(o => px < o.x + o.w && px + tw > o.x && py < o.y + o.h && py + th > o.y);
    if (hit) continue;
    // no walls between group and spot
    try {
      if (CONFIG.Canvas.polygonBackends.move.testCollision(c, { x: cx, y: cy }, { type: "move", mode: "any" })) continue;
    } catch (e) { /* if the test fails, allow the spot */ }
    return { x: px, y: py, w: tw, h: th };
  }
  return null;
}

/** Create tokens for actors near the group token. Returns count. */
async function placeActors(scene, groupTok, actors) {
  const taken = [];
  const docs = [];
  for (const actor of actors) {
    const spot = findSpot(scene, groupTok, actor, taken);
    if (!spot) {
      ui.notifications.warn(t("FGAMGA.Err.NoSpace", { name: actor.name }));
      continue;
    }
    taken.push({ x: spot.x, y: spot.y, w: spot.w, h: spot.h });
    const td = await actor.getTokenDocument({ x: spot.x, y: spot.y, elevation: groupTok.elevation ?? 0 });
    docs.push(td.toObject());
  }
  if (docs.length) await scene.createEmbeddedDocuments("Token", docs);
  return docs.length;
}

/* ---------- actions (run by the GM client, or the local GM) ---------- */

/**
 * mode "owner": requesting user handles their own members.
 * mode "gmExtract": GM places missing members. mode "gmStore": GM stores members in range.
 * Returns {ok, message, count}.
 */
async function performAction({ userId, sceneId, groupTokenId, mode }) {
  const user = game.users.get(userId);
  const scene = game.scenes.get(sceneId);
  const groupTok = scene?.tokens.get(groupTokenId);
  const groupActor = groupTok?.baseActor ?? groupTok?.actor;
  if (!user || !scene || !groupTok || !isCarrier(groupActor)) return { ok: false, error: "NotAllowed" };

  const members = getMembers(groupActor);

  if (mode === "owner") {
    if (!groupActor.testUserPermission(user, "OWNER")) return { ok: false, error: "NotAllowed" };
    const mine = userMembers(members, user);
    if (!mine.length) return { ok: false, error: "NotAllowed" };
    const toPlace = [];
    const toStore = [];
    for (const actor of mine) {
      const toks = tokensFor(scene, actor);
      if (!toks.length) { toPlace.push(actor); continue; }
      const tok = toks[0];
      if (!isWithin(scene, tok, groupTok)) return { ok: false, error: "TooFar", name: actor.name };
      toStore.push(...toks.map(x => x.id));
    }
    if (toStore.length) await scene.deleteEmbeddedDocuments("Token", toStore);
    const placed = toPlace.length ? await placeActors(scene, groupTok, toPlace) : 0;
    return { ok: true, placed, stored: toStore.length };
  }

  if (mode === "gmExtract") {
    if (!user.isGM) return { ok: false, error: "NotAllowed" };
    const missing = members.filter(a => tokensFor(scene, a).length === 0);
    const placed = missing.length ? await placeActors(scene, groupTok, missing) : 0;
    return { ok: true, placed, stored: 0 };
  }

  if (mode === "gmStore") {
    if (!user.isGM) return { ok: false, error: "NotAllowed" };
    const ids = [];
    for (const actor of members) {
      for (const tok of tokensFor(scene, actor)) if (isWithin(scene, tok, groupTok)) ids.push(tok.id);
    }
    if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
    return { ok: true, placed: 0, stored: ids.length };
  }
  return { ok: false, error: "NotAllowed" };
}

function report(res) {
  if (!res?.ok) {
    ui.notifications.error(t(`FGAMGA.Err.${res?.error ?? "NotAllowed"}`, { name: res?.name ?? "", range: radiusFeet() }));
    return;
  }
  if (res.placed) ui.notifications.info(t("FGAMGA.Info.Placed", { count: res.placed }));
  if (res.stored) ui.notifications.info(t("FGAMGA.Info.Stored", { count: res.stored }));
  if (!res.placed && !res.stored) ui.notifications.info(t("FGAMGA.Info.Nothing"));
}

let pendingReply = null;

/** Entry point from a button click. */
async function request(payload) {
  payload.userId = game.user.id;
  if (game.user.isGM) {
    report(await performAction(payload));
    return;
  }
  const gm = game.users.activeGM;
  if (!gm) { ui.notifications.error(t("FGAMGA.Err.NoGM")); return; }
  pendingReply = setTimeout(() => {
    pendingReply = null;
    ui.notifications.error(t("FGAMGA.Err.NoReply"));
  }, 6000);
  game.socket.emit(SOCKET, { type: "request", gmId: gm.id, payload });
}

/* ---------- HUD ---------- */

function makeButton(icon, label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "control-icon";
  btn.dataset.tooltip = label;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = `<i class="${icon}"></i>`;
  btn.addEventListener("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick();
  });
  return btn;
}

function onRenderTokenHUD(app, html) {
  const tokDoc = app.document ?? app.object?.document;
  const scene = tokDoc?.parent;
  const groupActor = tokDoc?.baseActor ?? tokDoc?.actor;
  if (!scene || !isCarrier(groupActor)) return;

  const root = html instanceof HTMLElement ? html : html[0];
  if (game.settings.get(ID, "blockGroupCombat")) {
    root.querySelector('[data-action="combat"]')?.remove();
  }
  const col = root.querySelector(".col.right") ?? root;
  const base = { sceneId: scene.id, groupTokenId: tokDoc.id };
  const members = getMembers(groupActor);

  if (game.user.isGM) {
    if (groupActor.type === "vehicle") {
      col.append(makeButton("fa-solid fa-list-check", t("FGAMGA.Gm.ManageCrew"), () => manageCrew(groupActor)));
    }
    col.append(makeButton("fa-solid fa-arrow-right-from-bracket", t("FGAMGA.Gm.Extract"), () => request({ ...base, mode: "gmExtract" })));
    col.append(makeButton("fa-solid fa-arrow-right-to-bracket", t("FGAMGA.Gm.Store"), () => request({ ...base, mode: "gmStore" })));
    return;
  }

  if (!groupActor.testUserPermission(game.user, "OWNER")) return;
  const mine = userMembers(members, game.user);
  if (!mine.length) return;
  const anyOnScene = mine.some(a => tokensFor(scene, a).length > 0);
  const label = anyOnScene ? t("FGAMGA.Owner.Store") : t("FGAMGA.Owner.Place");
  const icon = anyOnScene ? "fa-solid fa-person-walking-arrow-right" : "fa-solid fa-horse";
  col.append(makeButton(icon, label, () => request({ ...base, mode: "owner" })));
}

/* ---------- setup ---------- */

Hooks.once("init", () => {
  game.settings.register(ID, "radius", {
    name: "FGAMGA.Setting.Radius.Name",
    hint: "FGAMGA.Setting.Radius.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });
  game.settings.register(ID, "blockGroupCombat", {
    name: "FGAMGA.Setting.BlockCombat.Name",
    hint: "FGAMGA.Setting.BlockCombat.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, async data => {
    if (data?.type !== "request" || data.gmId !== game.user.id) return;
    const res = await performAction(data.payload);
    game.socket.emit(SOCKET, { type: "result", userId: data.payload.userId, res });
  });
  game.socket.on(SOCKET, data => {
    if (data?.type !== "result" || data.userId !== game.user.id) return;
    if (pendingReply) { clearTimeout(pendingReply); pendingReply = null; }
    report(data.res);
  });
});

Hooks.on("renderTokenHUD", onRenderTokenHUD);

/** Stop Group actors from joining combat. */
Hooks.on("preCreateCombatant", (combatant, data) => {
  if (!game.settings.get(ID, "blockGroupCombat")) return;
  const actor = combatant.actor ?? game.actors.get(data?.actorId);
  if (actor?.type !== "group") return;
  ui.notifications.warn(t("FGAMGA.Err.GroupCombat"));
  return false;
});
