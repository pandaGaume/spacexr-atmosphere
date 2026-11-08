# Rendre le paquet utilisable hors du laboratoire

Brief de recommandation du 2026-11-08, déposé pour une discussion ultérieure. Ce n'est pas un contrat.

## Ce qui est déjà utilisable

- **Le paquet `@spacexr/atmosphere` (`src`)** : TypeScript strict, ESM, sans DOM ni WebGPU.
    - Couches, compositions, presets, intégration spectrale CPU, tables pour le GPU (`spectrumBuffer`, `phaseTable`, profils convertis en kilomètres).
    - CI verte sur Node 20 et 22, TypeDoc, `npm pack` prêt.
- **Dépendance** : `@spacexr/geodesy@0.4.0`, la version que 3d-tiles-babylon utilise déjà. Un `file:` suffit pour le consommer.
- **Branche** : `feat/atmosphere-integration` est au même commit que `main`.

## Ce qui bloque

1. **Le rendu n'est pas dans le paquet.** LUT solaire, Sky-View et volume caméra vivent dans `examples/atmosphere-lab/src`, en JavaScript non typé, et rien n'est exporté.
2. **Le rendu possède le GPU au lieu de le recevoir.** Il crée son device et son canvas, appelle `context.configure` et présente lui-même l'image. Un moteur comme Babylon ne peut lui prêter ni son device ni sa passe de rendu.
3. **Les shaders sont fragiles à empaqueter.** Le WGSL est chargé par `fetch(new URL(..., import.meta.url))`, ce qui passe mal dans un bundler, puis modifié par 26 remplacements de texte, dont des expressions régulières sur le code source des shaders. Ce n'est ni versionnable ni testable comme une API.
4. **La caméra est figée.** `writeCamera` lève une erreur dès que la caméra se déplace. `reuseScore` et `reuseDuration` existent mais ne sont branchées nulle part.
5. **La précision n'est pas validée.** Le laboratoire calcule en kilomètres et en float32, et note lui-même un écart de transmittance d'environ 0.014 au limbe. La représentation relative à la caméra reste à étudier.
6. **Pas de perspective aérienne réelle.** La profondeur de scène est synthétique, et il n'existe pas de fonction qu'un matériau tiers pourrait appeler.
7. **La documentation mélange API et recherche.** Les notes en français et les mesures historiques sont mêlées au mode d'emploi.

## Recommandations, dans l'ordre

### P0. Le contrat avant le code

Un document de `docs` décrit ce qu'un moteur fournit et ce qu'il reçoit :

- **Entrées** : `IAtmosphere`, position de la caméra en ECEF et en double précision, sa base, direction du soleil, profondeur.
- **Sorties** : textures (transmittance, Sky-View, volume caméra) et fonctions de lecture `transmittanceToSun(p)`, `skyRadiance(direction)` et `aerialPerspective(color, pRelativeToCamera)`.

### P1. Le rendu WebGPU dans une entrée publique

Une entrée `@spacexr/atmosphere/webgpu`, ou un paquet frère, en TypeScript :

- **Device injecté**, sans canvas ni présentation.
- **Shaders dans des fichiers `.wgsl`** compilés en modules TypeScript, comme le fait `build-shaders` de 3d-tiles-babylon, et composés par includes et fonctions nommées, jamais par expressions régulières.
- **API minimale** : `create(device, atmosphere, options)`, `update(camera)`, `encode(encoder)`, `bindings()` et le WGSL des fonctions de lecture.
- **Le laboratoire devient le premier client de cette API**, et ses tests de régression la visent.

### P2. Une caméra mobile

- Calculs relatifs à la caméra, ce qui répond aussi à P3.
- Reconstruction décidée par `reuseScore`, ses budgets passés en options.
- Reconstruction explicite au passage entre l'intérieur et l'extérieur de l'atmosphère.
- Plus d'exception sur une translation.

### P3. La précision

La validation du laboratoire contre l'intégration CPU en double précision (`validate()`) devient un test du paquet, avec des tolérances écrites, au limbe et au sol.

### P4. La perspective aérienne côté moteur

Une fonction WGSL que le matériau du terrain appelle dans son fragment. Pas de post-traitement sur la profondeur : le moteur GPU de 3d-tiles-babylon déplace ses sommets dans le vertex shader, et un rendu de profondeur générique ne le reproduirait pas.

### P5. Le langage des shaders

WebGPU seul d'abord. Un jumeau GLSL ensuite, seulement si WebGL doit avoir le ciel, avec une comparaison pixel par pixel comme `npm run compare:renderers` de 3d-tiles-babylon.

### P6. Hygiène

- Un README d'API en anglais ; les notes de recherche passent dans `docs/research`.
- Un test WebGPU en Chrome headless dans la CI.
- Une première publication 0.1.0 sur npm, sur demande explicite. D'ici là, un consommateur lié par `file:` reçoit des jonctions npm vers ce dépôt : un `rm -rf` de son `node_modules` sous Windows les suit et vide ce dépôt. Supprimer les jonctions d'abord.

## Ce que garde l'adaptateur Babylon

Dans 3d-tiles-babylon : récupérer le device de `WebGPUEngine`, appeler `update` et `encode` à chaque image, et brancher les fonctions de lecture dans `instancedGrid` et le plugin de drapé.

## Jalon « utilisable »

Une page d'une cinquantaine de lignes, hors du laboratoire, qui passe son device au paquet, dessine un ciel suivant une caméra mobile, et valide sa Sky-View contre l'intégration CPU en Chrome headless. La branche `feat/atmosphere` de 3d-tiles-babylon devient alors simple.
