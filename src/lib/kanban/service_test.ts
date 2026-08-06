import { assertEquals } from "@std/assert";
import { board, closeAllBoards, setCardArrivedHandler } from "./service.ts";
import type { CardArrival } from "./board.ts";

// Every board this service opens forwards its arrivals, tagged with the scope that owns
// it — which is the only thing the service adds, and the thing the dispatcher needs to
// know whose automatons to look at.
Deno.test("an arrival reaches the registered handler with its scope", async () => {
  const home = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  const seen: { scope: string; arrival: CardArrival }[] = [];
  try {
    setCardArrivedHandler((scope, arrival) => seen.push({ scope, arrival }));
    const b = await board("root");
    const [backlog] = b.getBoard().statuses;
    const id = b.createCard({
      statusId: backlog.id,
      title: "Hi",
      actor: "human",
    });
    assertEquals(seen.length, 1);
    assertEquals(seen[0].scope, "root");
    assertEquals(seen[0].arrival.cardId, id);
    assertEquals(seen[0].arrival.statusName, backlog.name);
  } finally {
    setCardArrivedHandler(undefined);
    closeAllBoards();
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(home, { recursive: true });
  }
});
