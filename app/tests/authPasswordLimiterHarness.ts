const { api } = await import("../src/routes");
const { setSetting } = await import("../src/db");

await setSetting("auth_method", "shared");
await setSetting("auth_shared_username", "");
await setSetting("auth_shared_password_hash", await Bun.password.hash("correct-horse"));

const login = (username: string, password: string) => api.request("http://localhost/auth/password/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});

// Rotate usernames: shared mode has a single password, so all attempts from
// the same peer must share one bucket.
const wrong = [];
for (let i = 0; i < 5; i++) wrong.push((await login(`guess-${i}`, "wrong-password")).status);
const blocked = await login("rotated-username", "correct-horse");

const realNow = Date.now;
Date.now = () => realNow() + 16 * 60 * 1000;
const afterWindow = await login("rotated-username", "correct-horse");
Date.now = realNow;
const countsAgain = await login("guess-again", "wrong-password");

console.log("RESULT " + JSON.stringify({
  wrong,
  blocked: blocked.status,
  afterWindow: afterWindow.status,
  countsAgain: countsAgain.status,
}));
