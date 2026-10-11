export type OutboxMessage = {
  conversationId: string;
  clientMessageId: string;
  text: string;
  imageId?: string;
  createdAt: number;
};
type Settings = { accountId: string; key: CryptoKey; keyId: string };
type Stored = {
  id: string;
  accountId: string;
  expiresAt: number;
  iv: Uint8Array;
  encrypted: ArrayBuffer;
};
const name = "raahi-private-outbox-v1";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("settings", { keyPath: "accountId" });
      r.result
        .createObjectStore("messages", { keyPath: "id" })
        .createIndex("account", "accountId");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(
        new Error(
          "Browser storage is unavailable. Disable saved retries to send without storing them.",
        ),
      );
  });
}
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction, done: (value: T) => void) => void,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    let value: T;
    const tx = db.transaction(stores, mode);
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(new Error("Browser storage could not be updated. Please retry."));
    };
    try {
      run(tx, (v) => {
        value = v;
      });
    } catch (e) {
      tx.abort();
      db.close();
      reject(e);
    }
  });
}
async function settings(accountId: string) {
  return transaction<Settings | undefined>(
    ["settings"],
    "readonly",
    (tx, done) => {
      const r = tx.objectStore("settings").get(accountId);
      r.onsuccess = () => done(r.result);
    },
  );
}
export async function configureOutbox(accountId: string, enabled: boolean) {
  if (!enabled) {
    await transaction<void>(
      ["settings", "messages"],
      "readwrite",
      (tx, done) => {
        tx.objectStore("settings").delete(accountId);
        const r = tx
          .objectStore("messages")
          .index("account")
          .openCursor(IDBKeyRange.only(accountId));
        r.onsuccess = () => {
          const c = r.result;
          if (c) {
            c.delete();
            c.continue();
          } else done();
        };
      },
    );
    return;
  }
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  await transaction<void>(["settings"], "readwrite", (tx, done) => {
    const s = tx.objectStore("settings"),
      r = s.get(accountId);
    r.onsuccess = () => {
      if (!r.result) s.put({ accountId, key, keyId: crypto.randomUUID() });
      done();
    };
  });
}
export async function loadOutbox(accountId: string) {
  const config = await settings(accountId);
  if (!config) return { enabled: false, messages: [] as OutboxMessage[] };
  const stored = await transaction<Stored[]>(
    ["messages"],
    "readonly",
    (tx, done) => {
      const r = tx.objectStore("messages").index("account").getAll(accountId);
      r.onsuccess = () => done(r.result);
    },
  );
  const messages: OutboxMessage[] = [];
  for (const item of stored) {
    if (item.expiresAt < Date.now()) {
      await removeOutbox(item.id);
      continue;
    }
    const bytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(item.iv),
        additionalData: new TextEncoder().encode(accountId + ":" + item.id),
      },
      config.key,
      item.encrypted,
    );
    const message = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as OutboxMessage;
    if (
      message.clientMessageId !== item.id ||
      typeof message.text !== "string" ||
      message.text.length > 2000
    )
      throw new Error(
        "Saved retry data is invalid. Clear saved retries on this browser.",
      );
    messages.push(message);
  }
  return {
    enabled: true,
    messages: messages.sort((a, b) => a.createdAt - b.createdAt),
  };
}
export async function saveOutbox(accountId: string, message: OutboxMessage) {
  const config = await settings(accountId);
  if (!config) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(
        accountId + ":" + message.clientMessageId,
      ),
    },
    config.key,
    new TextEncoder().encode(JSON.stringify(message)),
  );
  await transaction<void>(["messages", "settings"], "readwrite", (tx, done) => {
    // Recheck consent in the write transaction: disabling or logging out in
    // another tab must not recreate records after they have been cleared.
    const r = tx.objectStore("settings").get(accountId);
    r.onsuccess = () => {
      if (r.result && r.result.keyId === config.keyId) {
        const store = tx.objectStore("messages");
        const count = store.index("account").count(accountId);
        count.onsuccess = () => {
          const existing = store.get(message.clientMessageId);
          existing.onsuccess = () => {
            if (count.result >= 100 && !existing.result) {
              tx.abort();
              return;
            }
            store.put({
              id: message.clientMessageId,
              accountId,
              iv,
              encrypted,
              expiresAt: message.createdAt + 72 * 3600000,
            });
            done();
          };
        };
      } else done();
    };
  });
}
export async function removeOutbox(id: string) {
  await transaction<void>(["messages"], "readwrite", (tx, done) => {
    tx.objectStore("messages").delete(id);
    done();
  });
}
export async function clearBrowserOutbox() {
  if (typeof indexedDB === "undefined") return;
  await transaction<void>(["messages", "settings"], "readwrite", (tx, done) => {
    tx.objectStore("messages").clear();
    tx.objectStore("settings").clear();
    done();
  });
}
