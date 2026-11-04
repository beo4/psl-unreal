# Rendering auf macOS mit UE 5.8 – Vorab-Einschätzung

Stand: 2026-11-04. **Noch nicht direkt gegen die Epic-Doku geprüft.** Die Werte stammen aus
Suchergebnissen, weil dev.epicgames.com in der damaligen Session gesperrt war. Bitte gegen die
unten verlinkten Seiten prüfen und diese Datei danach korrigieren.

## Feature-Matrix

| Feature | Stand macOS / UE 5.8 | Voraussetzung |
|---|---|---|
| Lumen, Software-Raytracing | unterstützt | Apple Silicon ab M1 |
| Lumen, Hardware-Raytracing + MegaLights | experimentell | ab M2 |
| Nanite + Virtual Shadow Maps | Beta | ab M2, Shader Model 6, macOS 15+ |
| Path Tracer | laut 5.8-Release-Notes neu auf dem Mac (Metal Ray Shaders) | macOS >= 26.4 (Treiberfehler) |
| Nanite-Foliage | Nanite auf dem Mac Beta; keine explizite Mac-Freigabe gefunden | ab M2 |
| Movie Render Graph | Production Ready in 5.8; keine Mac-Einschränkung gefunden | – |

Engine-Anforderungen 5.8 (laut Anforderungsseite): macOS min. 14.5, empfohlen 15;
Xcode 26.0 bis 26.1.1, **Xcode 26.4 laut Epic nicht kompatibel**.

## Folgerung für die Kamerafahrt Ruhpolding

- Hauptweg: Nanite-Landscape, Lumen (Software-RT), Virtual Shadow Maps, Sky Atmosphere,
  Volumetric Clouds, Rendering über Movie Render Graph mit vielen Samples als EXR/PNG-Folge.
- Hardware-Raytracing nur, wenn es auf dem Chip stabil läuft.
- Path Tracer nur für einzelne Stills (z. B. Plakatmotiv), nicht für das Video.
- Bäume am Pistenrand: klassische Meshes mit LODs als Rückfall, falls Nanite-Foliage Probleme macht.
- Mit M1 entfallen Nanite und Hardware-RT, mit macOS < 26.4 der Path Tracer.

## MCP-Server (UE 5.8, experimentell)

Plugins: Unreal MCP (ModelContextProtocol), AllToolsets, Editor Toolset. Start in der Konsole mit
`ModelContextProtocol.StartServer`, Standard-Port 8000, nur lokal, ohne Authentifizierung.
Client-Konfiguration: `ModelContextProtocol.GenerateClientConfig ClaudeCode`.
Nutzbar nur aus einer lokalen Claude-Code-Session auf dem Mac, nicht aus der Cloud.

## Quellen

- https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-release-notes?lang=en-US
- https://dev.epicgames.com/documentation/unreal-engine/macos-development-requirements-for-unreal-engine?lang=en-US
- https://dev.epicgames.com/documentation/en-us/unreal-engine/supported-features-by-rendering-path-for-desktop-with-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor?lang=en-US
- https://www.unrealengine.com/tech-blog/bringing-unreal-engine-on-macos-up-to-feature-parity-with-windowsprogress-report
- https://github.com/EpicGames/unreal-engine-skills-for-claude-code-plugin
