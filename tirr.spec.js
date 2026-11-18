// E2E TIRR 2026 (v2) — SOLO datos de prueba, SIEMPRE en "Vista de Prueba" (sin escrituras a Firebase).
// Equipos de prueba llevan prefijo QA_. Revisión 2: selectores verificados contra index.html/app.js.
const { test, expect } = require('@playwright/test');

const MODO_PRUEBA = '/?mode=test';

function captureDialogs(page, accept = true) {
  const msgs = [];
  page.on('dialog', async (d) => { msgs.push(d.message()); accept ? await d.accept() : await d.dismiss(); });
  return msgs;
}
async function entrarVistaPrueba(page) {
  await page.goto(MODO_PRUEBA);
  await expect(page.getByTestId('nav-dashboard')).toBeVisible({ timeout: 20_000 });
}
const irA = (page, testId) => page.getByTestId(testId).click();
const nTeams = (page) => page.evaluate(() => Alpine.store('app').teams.length);

// ───────────── F1 Ingreso / autenticación ─────────────
test.describe('F1 Ingreso y autenticación', () => {
  test('F1-OK Vista de Prueba desde el botón de login (sin PIN)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('login-vista-prueba').click();
    await page.getByRole('button', { name: /INGRESAR A VISTA DE PRUEBA/i }).click();
    await expect(page.getByTestId('nav-registro')).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => localStorage.getItem('tirr_test_mode'))).toBe('true');
  });

  test('F1-OK Vista de Prueba por URL ?mode=test', async ({ page }) => {
    await entrarVistaPrueba(page);
    expect(await page.evaluate(() => Alpine.store('app').isTestMode)).toBe(true);
  });

  test('F1-ERR PIN incorrecto en perfil real → "PIN INCORRECTO" y no autentica', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.Alpine && Alpine.store('app'));
    const res = await page.evaluate(async () => {
      const s = Alpine.store('app');
      const user = (s.systemUsers || []).find(u => u.role && u.role !== 'VISTA DE PRUEBA' && u.email);
      if (!user) return { sinPerfil: true };
      s.openLogin(user);
      s.loginPin = 'PIN-FALSO-QA';
      await s.login();
      return { error: s.loginError, auth: s.isAuthenticated };
    });
    test.skip(res.sinPerfil, 'No se encontró la lista de perfiles en el store; store.systemUsers vacío');
    expect(res.error).toBe('PIN INCORRECTO');
    expect(res.auth).toBeFalsy();
  });

  test('F1-OK Cerrar sesión limpia la sesión de prueba', async ({ page }) => {
    captureDialogs(page);
    await entrarVistaPrueba(page);
    await Promise.all([page.waitForNavigation().catch(() => {}), page.evaluate(() => Alpine.store('app').logout())]);
    await page.waitForLoadState('load');
    expect(await page.evaluate(() => localStorage.getItem('tirr_test_mode'))).toBeNull();
  });

  test('F1-ERR Configuración (admin) no es accesible desde Vista de Prueba', async ({ page }) => {
    await entrarVistaPrueba(page);
    await expect(page.getByTestId('nav-configuracion')).toHaveCount(0);
  });
});

// ───────────── F2 Registro e inspección técnica ─────────────
test.describe('F2 Registro de equipos', () => {
  const f = (page, k) => page.locator(`[x-model\\.number="form.${k}"], [x-model="form.${k}"]`).first();
  const form = (page) => page.locator('form:has([x-model="form.nombre_equipo"])');
  const enviar = (page) => form(page).locator('button[type=submit]').first().click();

  async function abrir(page) {
    await entrarVistaPrueba(page);
    await irA(page, 'nav-registro');
    await expect(f(page, 'nombre_equipo')).toBeVisible();
  }
  async function llenar(page, o = {}) {
    const d = { nombre_equipo: 'QA_Equipo', nombre_cohete: 'QA_Cohete', peso_cohete: '300', altura_cohete: '50', diametro_cohete: '10', ...o };
    for (const [k, v] of Object.entries(d)) await f(page, k).fill(v);
  }

  test('F2-OK registra equipo válido con integrante', async ({ page }) => {
    const dialogs = captureDialogs(page);
    await abrir(page);
    const antes = await nTeams(page);
    await llenar(page, { nombre_equipo: 'QA_Equipo Alfa', peso_cohete: '350', altura_cohete: '60' });
    await page.getByPlaceholder('NOMBRE DEL INTEGRANTE').fill('QA Integrante');
    await page.keyboard.press('Enter');
    await enviar(page);
    await expect.poll(() => dialogs.join('|')).toContain('registrado exitosamente');
    expect(await nTeams(page)).toBe(antes + 1);
  });

  // Capa 1: validación nativa del navegador (max/min/required) bloquea el submit.
  for (const [campo, valor, flag] of [
    ['peso_cohete', '401', 'rangeOverflow'],
    ['altura_cohete', '76', 'rangeOverflow'],
    ['diametro_cohete', '12.6', 'rangeOverflow'],
    ['peso_cohete', '-50', 'rangeUnderflow'],
  ]) {
    test(`F2-ERR ${campo}=${valor} bloqueado por validación nativa (${flag})`, async ({ page }) => {
      await abrir(page);
      const antes = await nTeams(page);
      await llenar(page, { [campo]: valor });
      await enviar(page);
      expect(await f(page, campo).evaluate((el, fl) => el.validity[fl], flag)).toBe(true);
      expect(await nTeams(page)).toBe(antes);
    });
  }

  test('F2-ERR nombre de equipo vacío bloqueado por required', async ({ page }) => {
    await abrir(page);
    const antes = await nTeams(page);
    await enviar(page);
    expect(await f(page, 'nombre_equipo').evaluate(el => el.validity.valueMissing)).toBe(true);
    expect(await nTeams(page)).toBe(antes);
  });

  // Capa 2: lógica JS (defensa en profundidad). Se invoca el método directo, saltando el navegador.
  async function registrarDirecto(page, overrides) {
    return page.evaluate(async (ov) => {
      const el = document.querySelector('section[x-data="registroController"]');
      const c = Alpine.$data(el);
      Object.assign(c.form, { nombre_equipo: 'QA_JS', nombre_cohete: 'QA_J', peso_cohete: 300, altura_cohete: 50, diametro_cohete: 10 }, ov);
      const antes = Alpine.store('app').teams.length;
      await c.registrarEquipo();
      return Alpine.store('app').teams.length - antes;
    }, overrides);
  }
  test('F2-ERR(JS) peso 401 rechazado por la lógica', async ({ page }) => {
    const dialogs = captureDialogs(page);
    await abrir(page);
    expect(await registrarDirecto(page, { peso_cohete: 401 })).toBe(0);
    expect(dialogs.join('|')).toMatch(/400g/);
  });
  test('F2-ERR(JS) peso negativo debe rechazarse por la lógica (BUG-01, severidad baja)', async ({ page }) => {
    captureDialogs(page);
    await abrir(page);
    expect(await registrarDirecto(page, { peso_cohete: -50 })).toBe(0);
  });
  test('F2-ERR(JS) medidas vacías no deben sustituirse por 250/50/8.5 (BUG-02)', async ({ page }) => {
    captureDialogs(page);
    await abrir(page);
    expect(await registrarDirecto(page, { peso_cohete: '', altura_cohete: '', diametro_cohete: '' })).toBe(0);
  });
});

// ───────────── F3 Cronometría ─────────────
test.describe('F3 Mesa de lanzamiento', () => {
  async function abrir(page) {
    await entrarVistaPrueba(page);
    await irA(page, 'nav-cronometro');
    const sel = page.locator('select[x-model="selectedTeamId"]:visible').first();
    await expect(sel).toBeVisible();
    return sel;
  }
  const visible = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first();

  test('F3-OK cronómetro táctico: iniciar → detener → guardar', async ({ page }) => {
    const dialogs = captureDialogs(page);
    const sel = await abrir(page);
    await sel.selectOption({ index: 1 });
    await visible(page, /Iniciar Vuelo/i).click();
    await page.waitForTimeout(1200);
    await visible(page, /Detener/i).click();
    await visible(page, /^Guardar/).click();
    await expect.poll(() => dialogs.join('|')).toMatch(/Registro cronometrado asegurado/);
  });

  test('F3-OK tiempo manual (Fijar) queda guardado en el equipo', async ({ page }) => {
    const dialogs = captureDialogs(page);
    const sel = await abrir(page);
    await sel.selectOption({ index: 1 });
    await page.locator('input[x-model="tiempoManualSec"]').fill('14.85');
    await visible(page, /^Fijar/i).click();
    await expect.poll(() => dialogs.join('|')).toMatch(/Tiempo manual fijado: 14\.85s/);
  });

  test('F3-OK Reportar Fallo (+1) incrementa el contador', async ({ page }) => {
    const dialogs = captureDialogs(page);
    const sel = await abrir(page);
    await sel.selectOption({ index: 1 });
    await visible(page, /Reportar Fallo/i).click();
    await expect.poll(() => dialogs.join('|')).toMatch(/Fallo reportado \(#1\)/);
  });

  test('F3-ERR tiempo manual negativo → alert "segundos válido"', async ({ page }) => {
    const dialogs = captureDialogs(page);
    const sel = await abrir(page);
    await sel.selectOption({ index: 1 });
    await page.locator('input[x-model="tiempoManualSec"]').fill('-5');
    await visible(page, /^Fijar/i).click();
    await expect.poll(() => dialogs.join('|')).toMatch(/número de segundos válido/);
  });

  test('F3-ERR Fijar sin equipo seleccionado → "Selecciona un equipo primero"', async ({ page }) => {
    const dialogs = captureDialogs(page);
    await abrir(page);
    await page.locator('input[x-model="tiempoManualSec"]').fill('10');
    await visible(page, /^Fijar/i).click();
    await expect.poll(() => dialogs.join('|')).toMatch(/Selecciona un equipo primero/);
  });
});

// ───────────── F4 Evaluación de jurados ─────────────
test.describe('F4 Evaluación tipo lista', () => {
  const campo = (page, k) => page.locator(`input[x-model\\.number="getRow(team.id).${k}"]`).first();
  async function abrir(page) {
    await entrarVistaPrueba(page);
    await irA(page, 'nav-calificacion-lista');
    await expect(campo(page, 'flight')).toBeVisible();
  }

  test('F4-OK autoguardado con Tab: se guarda calificación del juez de prueba', async ({ page }) => {
    await abrir(page);
    const antes = await page.evaluate(() => Alpine.store('app').allCalificaciones.length);
    await campo(page, 'flight').fill('35');
    await campo(page, 'flight').press('Tab');
    await expect.poll(() => page.evaluate(() => Alpine.store('app').allCalificaciones.length)).toBeGreaterThan(antes - 1);
    const cal = await page.evaluate(() => Alpine.store('app').allCalificaciones.find(c => c.id_juez === 'juez_prueba_ia'));
    expect(cal?.puntajes.flight).toBe(35);
  });

  test('F4-ERR Vuelo=99 se limita a 40', async ({ page }) => {
    await abrir(page);
    await campo(page, 'flight').fill('99');
    await campo(page, 'flight').press('Tab');
    await expect(campo(page, 'flight')).toHaveValue('40');
  });

  test('F4-ERR Diseño=-7 se limita a 0', async ({ page }) => {
    await abrir(page);
    await campo(page, 'design').fill('-7');
    await campo(page, 'design').press('Tab');
    await expect(campo(page, 'design')).toHaveValue('0');
  });

  test('F4-ERR Diseño=21 se limita a 15', async ({ page }) => {
    await abrir(page);
    await campo(page, 'design').fill('21');
    await campo(page, 'design').press('Tab');
    await expect(campo(page, 'design')).toHaveValue('15');
  });
});

// ───────────── F5/F6 Consolidación y resultados ─────────────
test.describe('F5/F6 Podio y Resultados Finales', () => {
  const leaderboard = (page) => page.evaluate(() => {
    const el = document.querySelector('section[x-data="resultadosController"]');
    return Alpine.$data(el).leaderboard.map(t => ({ nombre: t.nombre_equipo || t.nombre, score: t.score }));
  });

  test('F5-OK Podio carga sin errores de página', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrarVistaPrueba(page);
    await irA(page, 'nav-resultados');
    await expect(page.locator('section[x-data="resultadosController"] select[x-model="filtroCategoria"]').first()).toBeVisible();
    expect(errores).toEqual([]);
  });

  test('F5-ERR cambiar todos los filtros de categoría no rompe la vista', async ({ page }) => {
    await entrarVistaPrueba(page);
    await irA(page, 'nav-resultados');
    const sel = page.locator('section[x-data="resultadosController"] select[x-model="filtroCategoria"]').first();
    for (const o of await sel.locator('option').allTextContents()) await sel.selectOption({ label: o });
    await expect(page.getByTestId('nav-resultados')).toBeVisible();
  });

  test('F5-BUG-03 una nota guardada en Vista de Prueba debe reflejarse en el Podio', async ({ page }) => {
    await entrarVistaPrueba(page);
    await irA(page, 'nav-calificacion-lista');
    const flight = page.locator('input[x-model\\.number="getRow(team.id).flight"]').first();
    await flight.fill('40'); await flight.press('Tab');
    await page.waitForTimeout(800);
    await irA(page, 'nav-resultados');
    await page.waitForTimeout(1500);
    const lb = await leaderboard(page);
    expect(lb.some(t => t.score > 0)).toBe(true);
  });

  test('F6-OK Resultados Finales carga', async ({ page }) => {
    await entrarVistaPrueba(page);
    await irA(page, 'nav-resultados-finales');
    await expect(page.locator('section[x-data="resultadosFinalesController"]')).toBeVisible();
  });
});

// ───────────── F7 Gestión de equipos ─────────────
test.describe('F7 Equipos (edita/elimina)', () => {
  test('F7-OK elimina un equipo (solo en la sesión de prueba)', async ({ page }) => {
    const dialogs = captureDialogs(page);
    await entrarVistaPrueba(page);
    await irA(page, 'nav-equipos');
    const antes = await nTeams(page);
    await page.locator('button[title="Eliminar Equipo"]').first().click();
    await expect.poll(() => dialogs.join('|')).toMatch(/eliminado de la sesi[oó]n de prueba/);
    expect(await nTeams(page)).toBe(antes - 1);
  });

  test('F7-ERR cancelar la confirmación NO elimina', async ({ page }) => {
    captureDialogs(page, false);
    await entrarVistaPrueba(page);
    await irA(page, 'nav-equipos');
    const antes = await nTeams(page);
    await page.locator('button[title="Eliminar Equipo"]').first().click();
    await page.waitForTimeout(400);
    expect(await nTeams(page)).toBe(antes);
  });
});
