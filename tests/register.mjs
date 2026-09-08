// Einstiegspunkt für `node --import`: meldet den Alias-Hook an, bevor die
// erste Testdatei geladen wird. Getrennt von alias-hook.mjs, weil register()
// im Hauptthread laufen muss und der Hook selbst im Hook-Thread.

import { register } from "node:module";

register("./alias-hook.mjs", import.meta.url);
