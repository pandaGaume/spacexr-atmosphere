# Rendre le paquet utilisable hors du laboratoire

Suivi du brief initial du 2026-11-08. Le jalon ciel dispose désormais d'une API publique implémentée ; le contrat et les résultats de validation associés précisent son domaine d'utilisation. Les constats initiaux sont conservés ci-dessous pour expliquer le plan.

## Éléments disponibles au début des travaux

- **Le cœur `@spacexr/atmosphere` (`src`)** : TypeScript strict, ESM, sans DOM ni WebGPU. Il fournit les couches, compositions, presets, l'intégration spectrale CPU et les tables destinées au GPU (`spectrumBuffer`, `phaseTable`, profils convertis en kilomètres).
- **Dépendance** : exactement `@spacexr/geodesy@0.4.0`.
- **Distribution** : exports CPU et configuration de build, TypeDoc et `npm pack`. La CI est configurée pour Node 20 et 22 ; elle ne lance pas encore de validation WebGPU en navigateur.
- **Validation existante** : le chemin spectral compare la Sky-View à une intégration CPU indépendante. `docs/WEBGPU-VALIDATION.json` conserve des mesures pour une à quatre couches. Ces mesures enregistrées ne constituent pas un test automatique couvrant le sol, le limbe et les déplacements.

Au début des travaux, le cœur physique était réutilisable et le rendu restait une implémentation de laboratoire.

## Blocages identifiés au départ

1. **Le rendu n'est pas exporté.** LUT solaire, Sky-View et volume caméra vivent dans `examples/atmosphere-lab/src`, en JavaScript non typé. Aucune entrée WebGPU publique ne les distribue.
2. **Le moteur ne contrôle pas tout le cycle GPU.** `GpuSkyView` reçoit déjà un device, mais exige un canvas, configure son contexte et présente l'image. Les helpers de construction soumettent leurs propres commandes et attendent leur exécution. Injecter le device ne suffit donc pas : le moteur doit aussi contrôler les passes et la soumission.
3. **Les shaders sont fragiles à empaqueter.** Le WGSL est chargé par `fetch(new URL(..., import.meta.url))`, puis découpé et modifié par substitutions de texte, dont des expressions régulières. Les variantes spectrales et multicouches dépendent elles aussi du texte exact des shaders.
4. **La caméra ne peut pas translater en fonctionnement normal.** `writeCamera` lève une erreur après translation. Les fonctions de réutilisation restent expérimentales ; leur calibration refuse explicitement le mode spectral.
5. **La précision n'est pas suffisamment qualifiée.** Les positions ECEF sont converties en kilomètres et en float32. Les notes historiques signalent un écart de transmittance d'environ 0.014 au limbe. Une origine relative ne résout pas ce problème si le shader reconstruit ensuite une grande position ECEF en float32.
6. **La perspective aérienne n'a pas de contrat matériau.** Les essais de volume utilisent une profondeur synthétique. Aucun point d'entrée public ne reçoit la position réelle d'un fragment de terrain. La reconstruction spectrale de transmission est pondérée par le spectre solaire ; elle ne définit pas à elle seule l'atténuation d'une couleur RGB arbitraire.
7. **La documentation et les validations ne séparent pas assez API et recherche.** Les résultats enregistrés, hypothèses physiques et performances du laboratoire ne doivent pas être présentés comme des garanties d'intégration.

## État de la mise en œuvre du ciel intégrable

Le [contrat WebGPU du ciel](WEBGPU-INTEGRATION.md) décrit l'entrée publique implémentée, ses responsabilités et ses conventions. Le [protocole de précision](WEBGPU-PRECISION.md) définit les budgets et les cas CPU/GPU automatisés.

L'entrée `@spacexr/atmosphere/webgpu` reçoit le device et l'encoder du moteur. Elle fournit une construction progressive bornée, les bindings explicites et les lecteurs WGSL embarqués. Une translation reconstruit la Sky-View ; aucune réutilisation approximative n'est activée. Le mode spectral du laboratoire utilise cette API. `examples/sky-consumer` est un client autonome installé depuis un tarball par le test navigateur.

Les contrôles sont `npm run check`, `npm run test:webgpu` et `npm pack --dry-run`. Le test navigateur conserve son rapport local dans `.cache/webgpu-validation.json` et vérifie aussi les déplacements, les deux vues, la perte de device et le chemin public du laboratoire. La CI dédiée est configurée ; son exécution distante reste à constater après envoi des changements.

La perspective aérienne du terrain reste le second jalon. La réutilisation calibrée, le partage des ressources solaires entre yeux et les garanties de débit XR restent des optimisations ultérieures.

Les constats historiques et le plan ci-dessous sont conservés pour expliquer les travaux ; les points d'extraction, de caméra et de distribution du ciel sont désormais implémentés.

## Plan de corrections, dans l'ordre

### Étape 1. Définir le contrat et la précision

Documenter ce qu'un moteur fournit, ce que le paquet possède et les garanties de chaque sortie avant de figer l'API.

- **Entrées communes** : `IAtmosphere`, position caméra ECEF en double précision côté CPU, base de caméra, projection, dimensions de la vue et direction unitaire vers le soleil.
- **Conventions** : distances publiques en mètres ; X à longitude 0 et latitude 0, Y à longitude 90 degrés est, Z au pôle nord ; unités angulaires et transformations entre repère moteur et ECEF explicites.
- **Soleil** : préciser comment sa mise à jour s'articule avec `IAtmosphere.sun`, actuellement en lecture seule, afin de conserver une seule valeur de référence.
- **Sorties du ciel** : ressources de transmission solaire et de Sky-View, bindings et fonctions WGSL proposées `transmittanceToSun(pRelativeToCamera)` et `skyRadiance(direction)`.
- **Sorties terrain ultérieures** : volume caméra et fonction proposée `aerialPerspective(color, pRelativeToCamera)`, avec domaine de validité et comportement hors volume documentés.
- **Couleurs** : préciser l'espace RGB linéaire, la normalisation de radiance, l'approximation de transmission spectrale vers RGB et l'ordre de composition. Exposition, tone mapping et encodage d'affichage restent sous le contrôle du moteur.
- **Cycle de vie** : propriété des textures et buffers, `dispose()`, redimensionnement, perte du device, limites GPU, erreurs et validité des bindings après réallocation.
- **Plusieurs vues et XR** : état caméra distinct par vue ou œil ; partage des ressources indépendantes de la caméra sans écrasement des paramètres entre vues.

Choisir et mesurer la représentation numérique dès cette étape : origine locale, décomposition haute/basse ou géométrie compensée selon les résultats. Préserver altitude, intersections et tangences sans réintroduire les pertes float32 par une addition ECEF globale. Les conversions géodésiques CPU continuent de passer par `@spacexr/geodesy`.

**Sortie attendue** : contrat documenté et protocole de mesure de précision, sans promesse de précision fondée uniquement sur le terme « relatif caméra ».

### Étape 2. Extraire le rendu WebGPU

Créer une entrée `@spacexr/atmosphere/webgpu`, ou un paquet frère si cela permet de garder `src` exclusivement numérique conformément aux conventions du dépôt. Le cœur CPU doit rester importable sans DOM, WebGPU ni Babylon.

- Passer le rendu en TypeScript, avec interfaces publiques préfixées par `I` et documentées.
- Recevoir le `GPUDevice`, sans créer de canvas ni appeler `context.configure`.
- Proposer `create(device, atmosphere, options)`, `update(camera)`, `encode(encoder)`, `bindings()` et `dispose()`. Ces signatures restent à préciser dans le contrat.
- Encoder les constructions dans le command encoder fourni. L'appelant termine et soumet les commandes ; aucune attente GPU implicite par image. Les readbacks de validation sont des opérations explicites.
- Conserver les sources `.wgsl`, générer leurs modules importables au build et assembler des modules nommés par includes ou concaténation explicite, sans réécriture du code source par expressions régulières ou substitutions.
- Laisser le moteur dessiner le ciel avec les fonctions de lecture, ou fournir une aide de dessin utilisant une passe et un format explicitement fournis par l'appelant.
- Faire du laboratoire le premier client de l'entrée publique. Garder capture PNG, UI, statistiques et présentation dans le laboratoire.

**Sortie attendue** : un exemple externe consomme le paquet construit, sans import depuis `examples` et sans chargement de shaders depuis l'arborescence du dépôt.

### Étape 3. Rendre la caméra mobile et qualifier la précision

Commencer par une reconstruction correcte après translation, sans réutilisation approximative. Supprimer l'exception de translation et sélectionner explicitement le chemin intérieur ou extérieur lors du franchissement de l'enveloppe atmosphérique.

Transformer la validation en tests automatiques du paquet :

- Référence spectrale CPU indépendante en double précision, sans LUT solaire GPU partagée. Le `validate()` RGB actuel compare deux calculs GPU avec la même LUT et ne suffit pas comme référence indépendante.
- Vérification de convergence de la référence CPU avant de l'utiliser pour fixer les tolérances.
- Cas au sol, aux pôles, au terminateur, au limbe, hors atmosphère et de part et d'autre du changement de régime ; translations et rotations de caméra.
- Tolérances écrites et justifiées pour transmittance et radiance linéaire, avec erreurs absolues et relatives et traitement des valeurs proches de zéro.
- Test de plusieurs vues avec paramètres distincts pour détecter les écrasements de ressources caméra.
- Exécution Chrome headless en CI, avec échec explicite si WebGPU attendu n'est pas disponible et collecte des erreurs de compilation ou validation GPU.

Les mesures de `docs/WEBGPU-VALIDATION.json` restent des résultats historiques. La conformité numérique à la référence CPU ne vaut ni calibration observationnelle ni garantie de débit XR.

**Sortie attendue** : jalon « ciel intégrable » décrit ci-dessous.

### Étape 4. Intégrer la perspective aérienne au terrain

Construire et exposer le volume caméra, puis une fonction WGSL appelée dans le fragment du matériau. Elle reçoit la couleur linéaire déjà éclairée et la position du fragment relative à la caméra, correspondant à la géométrie après déplacement des sommets.

Dans 3d-tiles-babylon, cette position doit provenir du chemin de rendu réel de `instancedGrid` et du plugin de drapé. Un post-traitement fondé sur une profondeur générique ne reproduirait pas nécessairement les déplacements du vertex shader.

Définir et tester l'approximation RGB de l'atténuation spectrale, l'ajout de radiance diffusée, les unités de distance, l'interpolation des tranches, les limites du volume et le comportement hors domaine. Utiliser des matériaux neutres et colorés, pas uniquement le sol synthétique du laboratoire.

**Sortie attendue** : jalon « intégration terrain » décrit ci-dessous.

### Étape 5. Optimiser après validation

- Brancher `reuseScore` et `reuseDuration` uniquement après calibration du mode effectivement utilisé, notamment spectral. En l'absence de calibration valide, reconstruire.
- Exposer les budgets géométriques et photométriques ; vérifier la calibration sur des déplacements indépendants.
- Invalider les ressources concernées selon les changements de soleil, de couches, de paramètres spectraux, de projection et de qualité, ainsi que les transitions de régime. Documenter les dépendances de chaque cache.
- Mesurer séparément construction solaire, reconstruction Sky-View, volume caméra et affichage, avec mémoire consommée et matériel utilisé.
- Vérifier les coûts en mouvement et pour plusieurs vues avant toute revendication de performance XR.

**Sortie attendue** : politique de réutilisation mesurée, avec erreurs et coûts de reconstruction documentés.

### Étape 6. Finaliser la distribution et la documentation

- README d'API en anglais ; notes et mesures de recherche regroupées dans `docs/research`, avec liens et provenance conservés.
- Installation du tarball produit par `npm pack` dans un consommateur indépendant. Vérifier les exports, déclarations TypeScript et shaders embarqués ; un lien `file:` seul ne valide pas le contenu distribué.
- Régressions du laboratoire utilisant l'API publique et test WebGPU en CI dès le jalon ciel.
- WebGPU en premier. GLSL seulement si le besoin WebGL est confirmé, avec comparaisons de rendu documentées.
- Publication npm uniquement sur demande explicite ; aucun des deux jalons ne l'exige.

## Ce que garde l'adaptateur Babylon

Dans 3d-tiles-babylon : récupérer le device de `WebGPUEngine`, convertir les repères, gérer les vues et les yeux, appeler `update` et `encode`, ordonner les passes et soumettre les commandes. L'adaptateur branche les fonctions WGSL sur les matériaux et garde la présentation, l'exposition et le tone mapping du moteur.

Le paquet atmosphère possède ses ressources de calcul et documente leur cycle de vie. Il ne possède ni le canvas, ni le device, ni la boucle de rendu du consommateur.

## Jalon 1 : ciel intégrable

Une page minimale, hors du laboratoire, consomme le tarball du paquet et :

- fournit son propre device et contrôle canvas, passes et soumission ;
- dessine un ciel suivant une caméra qui tourne et translate, à l'intérieur puis à l'extérieur de l'atmosphère ;
- utilise uniquement les exports publics et les shaders embarqués ;
- valide la Sky-View contre la référence CPU indépendante en Chrome headless, avec tolérances et cas limites écrits ;
- vérifie l'isolation de plusieurs vues et la libération des ressources.

Ce jalon autorise l'intégration du ciel dans Babylon. Il ne valide pas encore la perspective aérienne du terrain et n'exige pas de réutilisation après translation.

## Jalon 2 : intégration terrain

Après le jalon ciel, une scène réelle de 3d-tiles-babylon :

- branche la fonction de perspective aérienne dans le fragment des matériaux terrain ;
- transmet les positions relatives issues des sommets réellement déplacés ;
- combine atténuation et radiance diffusée en espace linéaire avant l'exposition et le tone mapping du moteur ;
- valide plusieurs distances et couleurs de matériau, les limites du volume, les déplacements caméra et les vues distinctes ;
- compare les segments caméra-surface à une intégration CPU indépendante avec des tolérances documentées ;
- publie séparément les coûts du volume, de sa reconstruction et de sa lecture par le terrain.

Ce second jalon valide l'intégration du ciel et du terrain. L'optimisation de réutilisation et une éventuelle publication restent des étapes distinctes.
