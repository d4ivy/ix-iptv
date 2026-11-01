# Lista de canales de iptv-org validada

Lista diaria de canales de [iptv-org](https://github.com/iptv-org/iptv) cuyos streams se **comprueban de verdad**. iptv-org no verifica que sus streams funcionen: un día cualquiera entre el 25 y el 40 % de las URL están muertas. Este repo las prueba todas cada día con una GitHub Action y publica en GitHub Pages solo las que responden.

## Qué publica (esquema 1)

| Archivo | Contenido |
|---|---|
| `index.json` | `{ schema, generatedAt, source, defaultUserAgent, totals, countries: [{ code, name, spanish, channels }] }`: los países por número de canales vivos, con su nombre en español |
| `countries/<cc>.json` | `{ schema, generatedAt, country, channels: [{ id, name, logo?, categories, languages, sources: [{ url, referrer?, userAgent? }] }] }`: solo los canales con alguna URL viva y solo sus URL vivas, en orden de preferencia (calidad y 24/7) |
| `search.json` | `{ schema, generatedAt, channels: [[id, name, country, altNames?, logo?]] }`: un índice ligero para buscar canales (`altNames` va, aunque esté vacío, si hay `logo`) |
| `report.json` | El resumen de la ejecución: duración, descartes del cruce y motivos de fallo |

Quien consume la lista depende de este esquema, no del de iptv-org, que cambia sin versionar. Si iptv-org cambia el suyo, el validador aborta con un error claro, la Action sale en rojo y Pages sigue sirviendo la última lista buena.

## Cómo valida

1. Lee la API (`streams`, `channels`, `feeds`, `logos`, `blocklist`, `countries`, `categories`) y la cruza:
   - Une las URL por canal y feed, incluidas las de respaldo que `index.m3u` no trae.
   - Descarta los streams sin canal, los canales de la blocklist, los NSFW, los cerrados y las URL que no son `http(s)` o que apuntan a un destino local.
   - Limpia las cabeceras sucias de la fuente.
2. Pide el manifiesto de cada URL y, si es un maestro, su primera variante, con el Referer y el User-Agent de la fuente (o `defaultUserAgent`).
   - Es válida si se llega a un playlist de medios con segmentos.
   - Lo que no es HLS (TS continuo, páginas web, archivos de más de 2 MB) no pasa.
   - Un certificado TLS inválido tampoco pasa: la validación TLS es estricta.
3. Usa 48 peticiones a la vez, como mucho 2 por host y con 150 ms de pausa entre dos peticiones al mismo host, con 8 s por petición.

La Action corre en **Node 16.20.2**. Así, la validación TLS usa el almacén de certificados de Node 16, el de los clientes que todavía corren en ese runtime.

**Medidas de referencia:**
- En una muestra de 266 streams validados hasta el segmento, el 96–98 % de los que pasaban el manifiesto y la variante entregaban además un segmento válido.
- En una ejecución de un solo país, con 124 canales y 274 URL, quedaron vivos el 85 % de los canales en 69 s.

## Puesta en marcha (una sola vez)

1. Sube este repo a GitHub como repositorio **público**.
2. En **Settings → Pages → Build and deployment → Source**, elige **GitHub Actions**.
3. En **Actions → Actualizar canales**, pulsa **Run workflow**. La primera ejecución tarda del orden de 15–40 min.
4. Comprueba que abre `https://<usuario>.github.io/<repo>/index.json`. Esa es la URL base de la lista.

Desde ahí **funciona solo**: el cron lo ejecuta cada día a las 01:30 UTC. El job `keepalive` vuelve a habilitar el workflow en cada ejecución, porque GitHub desactiva los programados de un repo público tras 60 días sin actividad. Si alguna vez la lista deja de actualizarse, `generatedAt` en `index.json` lo dice.

## Uso local

```
npm test                                        # pruebas (sin red)
node src/cli.mjs --out data --countries MX      # solo un país → data/
npm run validate                                # todo el mundo → data/ (≈ 15–40 min)
npm run verify                                  # comprueba data/ como lo haría la Action
```

Las opciones del validador (países, concurrencia, timeouts, mínimo de canales…) están descritas al principio de `src/cli.mjs`. No tiene dependencias: solo Node ≥ 16.20.

## Límites conocidos

- **La Action valida desde servidores de GitHub (EE. UU.).** Un canal con geobloqueo puede aparecer vivo aquí y fallar en otro país, o al revés. Quien consume la lista debería probar las URL de respaldo en orden y recordar las que le fallan.
- Solo se valida hasta la variante: un 2–4 % de lo que la pasa podría fallar en los segmentos.
- Los datos de canales y enlaces son de iptv-org (Unlicense). Los logos son marcas de terceros. El contenido de los streams es de sus emisores.
