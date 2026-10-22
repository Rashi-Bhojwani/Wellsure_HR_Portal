import ExcelJS from "exceljs";
import request from "supertest";
import type { Express } from "express";
import { listApiRoutes } from "../../managers/__tests__/routeList";

// The sensitive-data scan's crawler (docs/plans/PHASE_6.md §14J): signed in as one person, it calls every GET route the API serves, with real ids filled in for the path
// parameters, and hands back what each answered as text (JSON, plain text, or the cells of an Excel file). The test then checks that no response contains a value that person
// must never see. A route that answers 403, 404 or 400 is fine; the point is that nothing that answers 200 carries a secret.

export interface Crawled {
  route: string;
  url: string;
  status: number;
  text: string;
}

export interface CrawlParams {
  /** Candidate values for a path parameter, by its name. The crawler tries up to six, taking the i-th of each parameter on its i-th pass. */
  [param: string]: string[];
}

async function textOf(contentType: string, body: Buffer): Promise<string> {
  if (/spreadsheetml|excel/.test(contentType)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body as unknown as ExcelJS.Buffer);
    const cells: string[] = [];
    wb.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((c) => cells.push(String(c.text ?? c.value ?? "")))));
    return cells.join("\n");
  }
  if (/json|text|csv|xml|html/.test(contentType)) return body.toString("utf8");
  return ""; // a PDF or an image: the routes that serve one are checked by status
}

export async function crawlGets(app: Express, token: string, params: CrawlParams, skip: RegExp = /^GET \/api\/(health|ready)/): Promise<Crawled[]> {
  const out: Crawled[] = [];
  for (const route of listApiRoutes().filter((r) => r.id.startsWith("GET ") && !skip.test(r.id))) {
    const path = route.id.slice(4);
    const names = [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
    const passes = names.length === 0 ? 1 : Math.min(6, Math.max(...names.map((n) => (params[n] ?? ["x"]).length)));
    for (let i = 0; i < passes; i += 1) {
      const url = path.replace(/:([A-Za-z]+)/g, (_m, n: string) => encodeURIComponent((params[n] ?? ["x"])[i % (params[n] ?? ["x"]).length]!));
      const res = await request(app)
        .get(url)
        .set("Authorization", `Bearer ${token}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      const type = String(res.headers["content-type"] ?? "");
      out.push({ route: route.id, url, status: res.status, text: await textOf(type, res.body as Buffer) });
    }
  }
  return out;
}
