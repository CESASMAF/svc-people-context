import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createPeopleRoutes } from "../../src/routes/people.ts";
import { createFakePersonRepository, createFakeRoleRepository } from "./fake-repositories.ts";
import { createFakeAuthGuard } from "./fake-auth.ts";
import { createFakePublisher } from "./fake-publisher.ts";
import { createNoopIdpClient } from "../../src/idp/index.ts";
import { parseJson, dataAs, dataAsArray, type IdData, type PersonData } from "./test-types.ts";

const setup = () => {
  const people = createFakePersonRepository();
  const roles = createFakeRoleRepository();
  const guard = createFakeAuthGuard();
  const publisher = createFakePublisher();
  const idp = createNoopIdpClient();
  const app = new Elysia().use(createPeopleRoutes({ people, roles, guard, publisher, idp }));
  return { app, people, publisher };
};

const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("POST /api/v1/people", () => {
  it("registers a person and returns 201 with id", async () => {
    const { app, publisher } = setup();
    const res = await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "Ana Costa", birthDate: "1990-05-15" }),
      ),
    );
    expect(res.status).toBe(201);
    const body = await parseJson(res);
    expect(dataAs<IdData>(body).id).toBeDefined();
    expect(body.meta.timestamp).toBeDefined();

    expect(publisher.published.length).toBe(1);
    expect(publisher.published[0]!.subject).toBe("people.person.registered");
    const eventData = (publisher.published[0]!.payload as { data: { fullName: string } }).data;
    expect(eventData.fullName).toBe("Ana Costa");
  });

  it("returns existing person on CPF dedup (no event published)", async () => {
    const { app, publisher } = setup();
    const first = await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "Ana Costa", cpf: "52998224725", birthDate: "1990-05-15" }),
      ),
    );
    const firstBody = await parseJson(first);
    expect(publisher.published.length).toBe(1);

    const second = await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "Ana C.", cpf: "52998224725", birthDate: "1990-05-15" }),
      ),
    );
    // 200, nao 201: nada foi criado. O chamador PRECISA distinguir reuso de criacao — respondendo
    // 201 sem sinal, a tela navegava para a ficha de OUTRA pessoa como se tivesse cadastrado.
    expect(second.status).toBe(200);
    const secondBody = await parseJson(second);
    const data = dataAs<IdData & { alreadyExisted?: boolean; fullName?: string }>(secondBody);
    expect(data.id).toBe(dataAs<IdData>(firstBody).id);
    expect(data.alreadyExisted).toBe(true);
    // devolve o nome de QUEM ja tem o CPF (a pessoa preexistente), nao o que veio no request
    expect(data.fullName).toBe("Ana Costa");
    // No new event on dedup
    expect(publisher.published.length).toBe(1);
  });

  it("returns 422 for empty fullName (schema validation)", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "", birthDate: "1990-05-15" }),
      ),
    );
    expect(res.status).toBe(422);
  });

  it("returns 422 for invalid cpf format (schema validation)", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "Ana", cpf: "123", birthDate: "1990-05-15" }),
      ),
    );
    expect(res.status).toBe(422);
  });
});

describe("GET /api/v1/people/by-cpf/:cpf — validation", () => {
  it("returns 400 for invalid cpf format", async () => {
    const { app } = setup();
    const res = await app.handle(new Request("http://localhost/api/v1/people/by-cpf/123"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric cpf", async () => {
    const { app } = setup();
    const res = await app.handle(new Request("http://localhost/api/v1/people/by-cpf/abcdefghijk"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/people/:personId — UUID validation", () => {
  it("returns 400 for invalid UUID", async () => {
    const { app } = setup();
    const res = await app.handle(new Request("http://localhost/api/v1/people/not-a-uuid"));
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/v1/people/:personId — UUID validation", () => {
  it("returns 400 for invalid UUID", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/not-a-uuid", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: "Ana", birthDate: "1990-05-15" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/people/:personId", () => {
  it("returns 200 with person data", async () => {
    const { app } = setup();
    const createRes = await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "Ana Costa", birthDate: "1990-05-15" }),
      ),
    );
    const { id } = dataAs<IdData>(await parseJson(createRes));

    const res = await app.handle(new Request(`http://localhost/api/v1/people/${id}`));
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(dataAs<PersonData>(body).fullName).toBe("Ana Costa");
    expect(dataAs<PersonData>(body).birthDate).toBe("1990-05-15");
  });

  it("returns 404 for unknown id", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000"),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/people/by-cpf/:cpf", () => {
  it("returns 200 when cpf exists", async () => {
    const { app } = setup();
    await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "Ana Costa", cpf: "52998224725", birthDate: "1990-05-15" }),
      ),
    );

    const res = await app.handle(new Request("http://localhost/api/v1/people/by-cpf/52998224725"));
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(dataAs<PersonData>(body).cpf).toBe("52998224725");
  });

  it("returns 404 when cpf not found", async () => {
    const { app } = setup();
    const res = await app.handle(new Request("http://localhost/api/v1/people/by-cpf/98765432100"));
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/v1/people/:personId", () => {
  it("returns 204 on successful update and publishes personUpdated event", async () => {
    const { app, publisher } = setup();
    const createRes = await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "Ana Costa", birthDate: "1990-05-15" }),
      ),
    );
    const { id } = dataAs<IdData>(await parseJson(createRes));
    publisher.published.length = 0; // reset after create event

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: "Ana Silva", birthDate: "1990-05-15" }),
      }),
    );
    expect(res.status).toBe(204);

    expect(publisher.published.length).toBe(1);
    expect(publisher.published[0]!.subject).toBe("people.person.updated");
    const eventData = (publisher.published[0]!.payload as { data: { fullName: string } }).data;
    expect(eventData.fullName).toBe("Ana Silva");
  });

  it("returns 404 for unknown person", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: "Ana", birthDate: "1990-05-15" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/people", () => {
  it("returns paginated list", async () => {
    const { app } = setup();
    await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "Ana Costa", birthDate: "1990-01-01" }),
      ),
    );
    await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "João Silva", birthDate: "1985-06-20" }),
      ),
    );

    const res = await app.handle(new Request("http://localhost/api/v1/people"));
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(dataAsArray<PersonData>(body).length).toBe(2);
    expect(body.meta.totalCount).toBe(2);
    expect(body.meta.hasMore).toBe(false);
  });

  it("filters by search", async () => {
    const { app } = setup();
    await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "Ana Costa", birthDate: "1990-01-01" }),
      ),
    );
    await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({ fullName: "João Silva", birthDate: "1985-06-20" }),
      ),
    );

    const res = await app.handle(new Request("http://localhost/api/v1/people?search=ana"));
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    const list = dataAsArray<PersonData>(body);
    expect(list.length).toBe(1);
    expect(list[0]!.fullName).toBe("Ana Costa");
  });
});
