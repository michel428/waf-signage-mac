# WAF Signage — appli Mac

Même appli que sur les boîtiers Android, pour un **Mac Intel sous macOS 10.13 High Sierra** (ou plus récent) :

- une fenêtre plein écran **par écran branché** (Écran 1 = le plus à gauche…), chacune avec sa configuration ;
- démarrage automatique à l'ouverture de session, **relance automatique si l'appli plante**, Mac jamais en veille ;
- **revient seul à l'affichage** si une autre appli est restée au premier plan (5 min, réglable dans le menu) ;
- veille réelle des moniteurs quand le club est fermé ;
- **lumières** : lyres DMX (adaptateur USB « Open DMX » FTDI) et ruban LED Bluetooth, exactement comme la box Android ;
- diagnostic du Mac dans le **Monitoring**, commandes à distance (redémarrer l'appli, **redémarrer le Mac**, installer la mise à jour) ;
- mises à jour installées toutes seules la nuit.

## Créer l'appli avec GitHub
1. Nouveau dépôt **public** (ex. `waf-signage-mac`), puis ajoute ce dossier avec GitHub Desktop et **Push**.
   ⚠️ Le dossier `.github` doit bien partir (il contient la recette de compilation).
2. Onglet **Actions** : compilation ≈ 8 min → **Releases** : `WAF-Signage.dmg` (première installation) et `waf-signage-mac.zip` (mises à jour).
3. Admin signage : **Réglages → Applis des écrans → Appli Mac** : `ton-compte/waf-signage-mac`.

## Installer sur le Mac
1. Télécharge `WAF-Signage.dmg`, ouvre-le et glisse **WAF Signage** dans **Applications**
   (obligatoire : hors du dossier Applications, les mises à jour automatiques ne marchent pas).
2. Premier lancement : l'appli n'est pas signée par Apple → **clic droit sur l'appli → Ouvrir → Ouvrir**.
   (Si macOS refuse encore : Préférences Système → Sécurité et confidentialité → « Ouvrir quand même ».)
3. Chaque écran affiche « Configurer cet écran » → **Nouvel écran** (code à saisir dans l'admin) ou **Écran existant**.

L'appli s'inscrit toute seule au démarrage de session (agent `~/Library/LaunchAgents/fr.wafforme.signage.plist`,
qui la relance aussi si elle plante). **Redémarre le Mac une fois** après la première installation pour l'activer.

Pour qu'elle revienne seule après une coupure de courant :
- **Préférences Système → Économiseur d'énergie** : cocher « Redémarrer automatiquement après une panne de courant » ;
- **Préférences Système → Utilisateurs et groupes → Options** : « Ouverture de session automatique » (FileVault doit être désactivé).

## Lumières
- **Lyres DMX** : branche l'adaptateur USB (puce FTDI). macOS 10.13 le reconnaît tout seul (pilote Apple intégré).
  S'il n'apparaît pas (« aucun adaptateur » dans le Monitoring), installe le pilote **FTDI VCP** pour macOS puis redémarre.
  L'appli réessaie toute seule toutes les 10 s et se reconnecte si le câble est débranché / rebranché.
- **Ruban LED** : Bluetooth du Mac allumé, appli Lotus fermée sur les téléphones. Activation et réglages dans l'admin (Lumières),
  ou depuis le menu de l'écran : « Ruban LED : connecter » / « Tester le ruban ».

## Mises à jour automatiques
Le Mac vérifie toutes les 30 min et installe la nouvelle version **entre 3 h et 5 h** (ou 10 min après un démarrage),
puis l'appli redémarre d'elle-même. Depuis l'admin : Monitoring → Redémarrer… → **Installer la mise à jour**.

## Raccourcis
- **F1**, **Ctrl+M** ou **Cmd+M** : menu de l'écran (changer d'écran, recharger, ruban LED…)
- **5 clics** dans le coin haut-gauche d'un écran : menu
- **Ctrl+Alt+R** (ou Cmd+Alt+R) : tout recharger · **Ctrl+Alt+Q** (ou Cmd+Alt+Q) : quitter

Configuration enregistrée dans `~/Library/Application Support/WAF Signage/config.json`.

---
Techniquement : Electron 26 (dernière version compatible High Sierra, moteur Chrome 116), compilé pour Mac Intel (x64).
DMX par Web Serial (250 000 bauds, 8N2, BREAK), ruban par Web Bluetooth — sans module natif à compiler.
