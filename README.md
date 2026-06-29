# homebridge-hon

Homebridge plugin para aparatos Haier/Candy/Hoover controlados mediante la app **hOn**.

> Basado en la ingeniería inversa de la API hOn realizada por [gvigroux/hon](https://github.com/gvigroux/hon) y [Andre0512/hOn](https://github.com/Andre0512/hOn).

## Dispositivos soportados

| Tipo | HomeKit Service | Estado |
|------|----------------|--------|
| Aire acondicionado (AC) | HeaterCooler | ✅ Completo |
| Lavadora (WM) | — | 🔜 Próximamente |
| Lavavajillas (DW) | — | 🔜 Próximamente |
| Secadora (TD) | — | 🔜 Próximamente |

## Instalación

```bash
npm install -g homebridge-hon
```

O instálalo desde la UI de Homebridge buscando **homebridge-hon**.

## Configuración

Añade el siguiente bloque a tu `~/.homebridge/config.json`:

```json
{
  "platforms": [
    {
      "platform": "HonPlatform",
      "name": "hOn",
      "email": "tu@email.com",
      "password": "tu_contraseña_hon",
      "pollingInterval": 30
    }
  ]
}
```

### Parámetros

| Campo | Tipo | Requerido | Default | Descripción |
|-------|------|-----------|---------|-------------|
| `email` | string | ✅ | — | Email de tu cuenta hOn |
| `password` | string | ✅ | — | Contraseña de tu cuenta hOn |
| `pollingInterval` | number | ❌ | 30 | Segundos entre actualizaciones (10–300) |

## Funcionalidades del aire acondicionado

Una vez configurado, cada unidad de AC aparece en HomeKit como un accesorio **HeaterCooler** con:

- **Encendido/apagado**
- **Modo**: Auto / Calor / Frío
- **Temperatura objetivo** (16–30 °C)
- **Temperatura actual** (sensor interior)
- **Velocidad del ventilador**: Baja / Media / Alta / Auto (mapeado como RotationSpeed 0–100%)
- **Oscilación** (horizontal + vertical)

## Desarrollo local

```bash
git clone https://github.com/mazafra1/homebridge-hon
cd homebridge-hon
npm install
npm run build

# Enlazar con Homebridge local
npm link

# Desarrollo con recarga automática
npm run watch
```

## Arquitectura

```
src/
├── index.ts              # Entry point – registra el plugin
├── platform.ts           # Descubrimiento de dispositivos + polling
├── honApi.ts             # Cliente HTTP de la API hOn (auth + comandos)
├── settings.ts           # Constantes y códigos de dispositivo
└── accessories/
    └── acAccessory.ts    # Lógica del aire acondicionado
```

## Notas sobre la API hOn

- La autenticación usa **Keycloak OAuth2** con client_id `hon-ios`.
- Los tokens se refrescan automáticamente antes de expirar.
- El estado del dispositivo se obtiene del endpoint `/context` (shadow state).
- Los comandos se envían al endpoint `/commands` con `commandName: 'settings'`.

## Licencia

MIT
