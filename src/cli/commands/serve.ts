import { startServer } from "../../viewer/server";

export async function serve(): Promise<number> {
  await startServer();
  // Keep process alive
  await new Promise(() => {});
  return 0;
}
