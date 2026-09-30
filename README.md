# FGA Mount Action

Version 2026.09.29.01. For Foundry VTT v13 and the D&D 5e system.

Adds buttons to the right-click token HUD of a D&D 5e Group token or Vehicle token.

## Vehicle crew

A Vehicle actor has no built-in member list, so the GM sets its crew roster with a
"Manage Crew" button (GM only). Pick which actors count as crew, then the Owner
and GM buttons below work on a Vehicle exactly like they do on a Group.

## Player button (owner)

Shown when you own the Group/Vehicle and you own a member (or crew), or a member is your default Player Character.

- If your member has no token on the scene, it places one at a random free spot within 10 feet of the group.
- If your member token is on the scene and within 10 feet of the group, it removes that token.
- If your token is more than 10 feet away, you get an error.
- Only one token per member can be on the scene at a time.

## GM buttons

On a Vehicle, a third button, Manage Crew, lets the GM pick the crew roster.

- Extract Members: places only the members with no token on the scene, at random free spots within 10 feet.
- Store Members: removes member tokens within 10 feet of the group.

## Combat

Groups cannot be added to combat. This is a world setting, on by default.

## Notes

- Placed tokens avoid other tokens and walls.
- Players cannot create tokens, so a GM must be online. The GM client does the work.
- The range is a world setting. Default is 10 feet.

## Install

Use the manifest URL from your GitHub release for module.json.

## Install from GitHub

In Foundry, open Add-on Modules, then Install Module.
Paste this Manifest URL and click Install:

`https://github.com/drmogie/fga-mount-action/releases/latest/download/module.json`
