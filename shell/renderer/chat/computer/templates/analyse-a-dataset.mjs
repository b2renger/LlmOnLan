// @ts-check
// Template — Analyse a dataset (owner, 2026-09-27: "paste a dataset link and do an analysis of the data"). DATA
// only. The Open data box reads a data.gouv.fr dataset; code turns data.gouv.fr's whole-file counts into facts,
// a table and a chart; a model explains in words and writes a program for your own question. Every number
// comes from data.gouv.fr or the code (a digit a model writes becomes …), as in "Read the news".
//
// 3 generations: Read it, Choose the chart, Write code. SNAPSHOT is what the Open data box itself read on
// 2026-09-27 (the whole-file column counts and the first 20 rows, the contact e-mail column left out), so the
// template runs offline.

// Exported: "Ask a dataset" opens with the same copy.
export const SNAPSHOT = {
 "source": "data.gouv.fr",
 "dataset": {
  "title": "Liste des festivals en France",
  "organization": "Ministère de la Culture",
  "licence": "lov2",
  "updated": "2026-09-17",
  "page": "https://www.data.gouv.fr/datasets/liste-des-festivals-en-france",
  "description": "Sont considérés comme festivals les événements qui répondent aux critères suivants :   \n\\- avoir eu lieu en 2019  \n\\- avoir connu au moins deux éditions en 2019  \n\\- se dérouler sur plus d’une journée  \n\\- compter au moins 5 spectacles, représentations, concerts ou projections  \nLe choix a été fait de retenir l’année 2019 qui devient, dans le champ culturel, l’année-repère ante pandémie.\n\nSource : Cartographie nationale, Ministère de la Culture, Deps-doc / France festivals / Cepel, 2022\n\nNB : en l'absence d'adresse postale, le festival est géolocalisé par rapport au centroïde de la commune."
 },
 "file": {
  "id": "47ac11c2-8a00-46a7-9fa8-9b802643f975",
  "title": "festivals-global-festivals",
  "format": "csv"
 },
 "total": 7283,
 "read": 20,
 "columns": [
  {
   "name": "Nom du festival",
   "format": "string",
   "type": "string",
   "distinct": 7171,
   "missing": 0,
   "tops": [
    {
     "value": "Salon du livre",
     "count": 6
    },
    {
     "value": "Festival du rire",
     "count": 6
    },
    {
     "value": "Salon du livre jeunesse",
     "count": 5
    },
    {
     "value": "Festival de théâtre",
     "count": 4
    },
    {
     "value": "Salon du livre ancien et d'occasion",
     "count": 4
    },
    {
     "value": "Printemps du livre",
     "count": 3
    },
    {
     "value": "Festival de l'humour",
     "count": 3
    },
    {
     "value": "Quartiers d'été",
     "count": 3
    },
    {
     "value": "Les estivales",
     "count": 3
    },
    {
     "value": "Camping",
     "count": 2
    }
   ]
  },
  {
   "name": "Envergure territoriale",
   "format": "string",
   "type": "string",
   "distinct": 71,
   "missing": 5384,
   "tops": [
    {
     "value": "Intercommunale",
     "count": 770
    },
    {
     "value": "Régionale",
     "count": 349
    },
    {
     "value": "Départementale",
     "count": 325
    },
    {
     "value": "Communale",
     "count": 126
    },
    {
     "value": "Interrégionale",
     "count": 58
    },
    {
     "value": "Internationale",
     "count": 54
    },
    {
     "value": "Transfrontalière",
     "count": 46
    },
    {
     "value": "Nationale",
     "count": 38
    },
    {
     "value": "intercommunale",
     "count": 16
    },
    {
     "value": "Régional",
     "count": 12
    }
   ]
  },
  {
   "name": "Région principale de déroulement",
   "format": "string",
   "type": "string",
   "distinct": 22,
   "missing": 0,
   "tops": [
    {
     "value": "Auvergne-Rhône-Alpes",
     "count": 947
    },
    {
     "value": "Provence-Alpes-Côte d'Azur",
     "count": 942
    },
    {
     "value": "Occitanie",
     "count": 903
    },
    {
     "value": "Nouvelle-Aquitaine",
     "count": 828
    },
    {
     "value": "Île-de-France",
     "count": 654
    },
    {
     "value": "Bretagne",
     "count": 590
    },
    {
     "value": "Grand Est",
     "count": 469
    },
    {
     "value": "Bourgogne-Franche-Comté",
     "count": 442
    },
    {
     "value": "Centre-Val de Loire",
     "count": 357
    },
    {
     "value": "Hauts-de-France",
     "count": 338
    }
   ]
  },
  {
   "name": "Département principal de déroulement",
   "format": "departement",
   "type": "string",
   "distinct": 110,
   "missing": 26,
   "tops": [
    {
     "value": "Bouches-du-Rhône",
     "count": 305
    },
    {
     "value": "Paris",
     "count": 298
    },
    {
     "value": "Var",
     "count": 193
    },
    {
     "value": "Ille-et-Vilaine",
     "count": 184
    },
    {
     "value": "Gironde",
     "count": 180
    },
    {
     "value": "Alpes-Maritimes",
     "count": 179
    },
    {
     "value": "Hérault",
     "count": 154
    },
    {
     "value": "Vaucluse",
     "count": 151
    },
    {
     "value": "Finistère",
     "count": 144
    },
    {
     "value": "Nord",
     "count": 143
    }
   ]
  },
  {
   "name": "Commune principale de déroulement",
   "format": "commune",
   "type": "string",
   "distinct": 3157,
   "missing": 26,
   "tops": [
    {
     "value": "Paris",
     "count": 299
    },
    {
     "value": "Marseille",
     "count": 111
    },
    {
     "value": "Toulouse",
     "count": 92
    },
    {
     "value": "Lyon",
     "count": 77
    },
    {
     "value": "Rennes",
     "count": 76
    },
    {
     "value": "Strasbourg",
     "count": 57
    },
    {
     "value": "Montpellier",
     "count": 51
    },
    {
     "value": "Lille",
     "count": 51
    },
    {
     "value": "Avignon",
     "count": 47
    },
    {
     "value": "Nantes",
     "count": 43
    }
   ]
  },
  {
   "name": "Code postal (de la commune principale de déroulement)",
   "format": "string",
   "type": "string",
   "distinct": 2701,
   "missing": 17,
   "tops": [
    {
     "value": "35000",
     "count": 72
    },
    {
     "value": "31000",
     "count": 67
    },
    {
     "value": "67000",
     "count": 58
    },
    {
     "value": "44000",
     "count": 44
    },
    {
     "value": "59000",
     "count": 44
    },
    {
     "value": "34000",
     "count": 43
    },
    {
     "value": "84000",
     "count": 41
    },
    {
     "value": "33000",
     "count": 40
    },
    {
     "value": "69000",
     "count": 35
    },
    {
     "value": "21000",
     "count": 34
    }
   ]
  },
  {
   "name": "Code Insee commune",
   "format": "code_commune_insee",
   "type": "string",
   "distinct": 3112,
   "missing": 1,
   "tops": [
    {
     "value": "75056",
     "count": 297
    },
    {
     "value": "13055",
     "count": 119
    },
    {
     "value": "31555",
     "count": 92
    },
    {
     "value": "35238",
     "count": 76
    },
    {
     "value": "69123",
     "count": 75
    },
    {
     "value": "67482",
     "count": 57
    },
    {
     "value": "34172",
     "count": 52
    },
    {
     "value": "59350",
     "count": 51
    },
    {
     "value": "84007",
     "count": 46
    },
    {
     "value": "44109",
     "count": 43
    }
   ]
  },
  {
   "name": "Code Insee EPCI",
   "format": "siren",
   "type": "string",
   "distinct": 1046,
   "missing": 36,
   "tops": [
    {
     "value": "200054781",
     "count": 303
    },
    {
     "value": "200054807",
     "count": 269
    },
    {
     "value": "200046977",
     "count": 129
    },
    {
     "value": "243100518",
     "count": 106
    },
    {
     "value": "200093201",
     "count": 90
    },
    {
     "value": "243500139",
     "count": 89
    },
    {
     "value": "243300316",
     "count": 82
    },
    {
     "value": "200030195",
     "count": 71
    },
    {
     "value": "243400017",
     "count": 66
    },
    {
     "value": "248300543",
     "count": 64
    }
   ]
  },
  {
   "name": "Libellé EPCI",
   "format": "string",
   "type": "string",
   "distinct": 1063,
   "missing": 36,
   "tops": [
    {
     "value": "Métropole du Grand Paris",
     "count": 308
    },
    {
     "value": "Métropole d'Aix-Marseille-Provence",
     "count": 270
    },
    {
     "value": "Métropole de Lyon",
     "count": 129
    },
    {
     "value": "Toulouse Métropole",
     "count": 106
    },
    {
     "value": "Métropole Européenne de Lille",
     "count": 90
    },
    {
     "value": "Rennes Métropole",
     "count": 89
    },
    {
     "value": "Bordeaux Métropole",
     "count": 82
    },
    {
     "value": "Métropole Nice Côte d'Azur",
     "count": 71
    },
    {
     "value": "Montpellier Méditerranée Métropole",
     "count": 66
    },
    {
     "value": "Métropole Toulon-Provence-Méditerranée",
     "count": 64
    }
   ]
  },
  {
   "name": "Numéro de voie",
   "format": "string",
   "type": "string",
   "distinct": 342,
   "missing": 5078,
   "tops": [
    {
     "value": "1",
     "count": 405
    },
    {
     "value": "2",
     "count": 115
    },
    {
     "value": "3",
     "count": 83
    },
    {
     "value": "4",
     "count": 79
    },
    {
     "value": "5",
     "count": 73
    },
    {
     "value": "6",
     "count": 71
    },
    {
     "value": "7",
     "count": 58
    },
    {
     "value": "8",
     "count": 54
    },
    {
     "value": "10",
     "count": 54
    },
    {
     "value": "9",
     "count": 49
    }
   ]
  },
  {
   "name": "Type de voie (rue, Avenue, boulevard, etc.)",
   "format": "string",
   "type": "string",
   "distinct": 99,
   "missing": 4411,
   "tops": [
    {
     "value": "Rue",
     "count": 998
    },
    {
     "value": "Place",
     "count": 470
    },
    {
     "value": "Avenue",
     "count": 331
    },
    {
     "value": "rue",
     "count": 175
    },
    {
     "value": "Boulevard",
     "count": 145
    },
    {
     "value": "Route",
     "count": 125
    },
    {
     "value": "Chemin",
     "count": 124
    },
    {
     "value": "Allée",
     "count": 77
    },
    {
     "value": "place",
     "count": 48
    },
    {
     "value": "Quai",
     "count": 35
    }
   ]
  },
  {
   "name": "Nom de la voie",
   "format": "string",
   "type": "string",
   "distinct": 2822,
   "missing": 3782,
   "tops": [
    {
     "value": "de la Mairie",
     "count": 26
    },
    {
     "value": "de la République",
     "count": 15
    },
    {
     "value": "Gambetta",
     "count": 13
    },
    {
     "value": "du Château",
     "count": 12
    },
    {
     "value": "de l'Hôtel de Ville",
     "count": 10
    },
    {
     "value": "Jean Jaurès",
     "count": 9
    },
    {
     "value": "de l'Eglise",
     "count": 9
    },
    {
     "value": "du Général de Gaulle",
     "count": 9
    },
    {
     "value": "Mairie",
     "count": 9
    },
    {
     "value": "Jobin",
     "count": 9
    }
   ]
  },
  {
   "name": "Adresse postale",
   "format": "adresse",
   "type": "string",
   "distinct": 3244,
   "missing": 3771,
   "tops": [
    {
     "value": "41 Rue Jobin",
     "count": 9
    },
    {
     "value": "Place de la Mairie",
     "count": 7
    },
    {
     "value": "Place de l'Hôtel de Ville",
     "count": 6
    },
    {
     "value": "Mairie",
     "count": 6
    },
    {
     "value": "1 Place de la Mairie",
     "count": 6
    },
    {
     "value": "Place De l'église",
     "count": 5
    },
    {
     "value": "#NOM?",
     "count": 5
    },
    {
     "value": "1 Boulevard De la croisette",
     "count": 5
    },
    {
     "value": "Place de l'Eglise",
     "count": 5
    },
    {
     "value": "Parc d'activités La providence",
     "count": 5
    }
   ]
  },
  {
   "name": "Complément d'adresse (facultatif)",
   "format": "string",
   "type": "string",
   "distinct": 2040,
   "missing": 5081,
   "tops": [
    {
     "value": "Mairie",
     "count": 37
    },
    {
     "value": "Salle des fêtes",
     "count": 9
    },
    {
     "value": "Le Bourg",
     "count": 7
    },
    {
     "value": "Salle polyvalente",
     "count": 7
    },
    {
     "value": "Hôtel de Ville",
     "count": 6
    },
    {
     "value": "Théâtre de verdure",
     "count": 5
    },
    {
     "value": "Hôtel de ville",
     "count": 5
    },
    {
     "value": "MAIRIE",
     "count": 5
    },
    {
     "value": "Friche la belle de mai",
     "count": 5
    },
    {
     "value": "Château de l'emperi",
     "count": 5
    }
   ]
  },
  {
   "name": "Site internet du festival",
   "format": "string",
   "type": "string",
   "distinct": 6294,
   "missing": 725,
   "tops": [
    {
     "value": "www.villeneuveloubet.fr",
     "count": 6
    },
    {
     "value": "/",
     "count": 6
    },
    {
     "value": "www.antibesjuanlespins.com",
     "count": 5
    },
    {
     "value": "http://www.ville-lehaillan.fr/",
     "count": 4
    },
    {
     "value": "www.cinecroisette.com",
     "count": 4
    },
    {
     "value": "www.aixenprovence.fr",
     "count": 4
    },
    {
     "value": "www.ville-antony.fr",
     "count": 3
    },
    {
     "value": "www.cinemanivel.fr",
     "count": 3
    },
    {
     "value": "www.ville-carros.fr",
     "count": 3
    },
    {
     "value": "www.ville-embrun.fr",
     "count": 3
    }
   ]
  },
  {
   "name": "Décennie de création du festival",
   "format": "string",
   "type": "string",
   "distinct": 9,
   "missing": 369,
   "tops": [
    {
     "value": "2010 et après",
     "count": 3358
    },
    {
     "value": "De 2000 à 2009",
     "count": 1927
    },
    {
     "value": "De 1990 à 1999",
     "count": 961
    },
    {
     "value": "De 1980 à 1989",
     "count": 413
    },
    {
     "value": "Avant 1980",
     "count": 212
    },
    {
     "value": "de 1980 à 1989",
     "count": 20
    },
    {
     "value": "de 2000 à 2009",
     "count": 11
    },
    {
     "value": "de 1990 à 1999",
     "count": 10
    },
    {
     "value": "avant 1980",
     "count": 2
    }
   ]
  },
  {
   "name": "Année de création du festival",
   "format": "string",
   "type": "string",
   "distinct": 185,
   "missing": 1448,
   "tops": [
    {
     "value": "2015",
     "count": 347
    },
    {
     "value": "2016",
     "count": 320
    },
    {
     "value": "2017",
     "count": 316
    },
    {
     "value": "2018",
     "count": 278
    },
    {
     "value": "2011",
     "count": 249
    },
    {
     "value": "2012",
     "count": 232
    },
    {
     "value": "2014",
     "count": 226
    },
    {
     "value": "2009",
     "count": 216
    },
    {
     "value": "2010",
     "count": 216
    },
    {
     "value": "2013",
     "count": 214
    }
   ]
  },
  {
   "name": "Discipline dominante",
   "format": "string",
   "type": "string",
   "distinct": 6,
   "missing": 0,
   "tops": [
    {
     "value": "Musique",
     "count": 3229
    },
    {
     "value": "Spectacle vivant",
     "count": 1634
    },
    {
     "value": "Livre, littérature",
     "count": 892
    },
    {
     "value": "Cinéma, audiovisuel",
     "count": 684
    },
    {
     "value": "Pluridisciplinaire",
     "count": 462
    },
    {
     "value": "Arts visuels, arts numériques",
     "count": 382
    }
   ]
  },
  {
   "name": "Sous-catégorie spectacle vivant",
   "format": "string",
   "type": "string",
   "distinct": 202,
   "missing": 5828,
   "tops": [
    {
     "value": "Théâtre",
     "count": 431
    },
    {
     "value": "Arts de la rue",
     "count": 200
    },
    {
     "value": "Danse",
     "count": 188
    },
    {
     "value": "Spectacle vivant pluridisciplinaire",
     "count": 146
    },
    {
     "value": "Arts du cirque",
     "count": 59
    },
    {
     "value": "Cirque, Arts de la rue",
     "count": 32
    },
    {
     "value": "Humour",
     "count": 29
    },
    {
     "value": "Conte",
     "count": 28
    },
    {
     "value": "Marionnettes et théâtre d'objet",
     "count": 28
    },
    {
     "value": "Cirque",
     "count": 20
    }
   ]
  },
  {
   "name": "Sous-catégorie musique",
   "format": "string",
   "type": "string",
   "distinct": 802,
   "missing": 4664,
   "tops": [
    {
     "value": "Musiques actuelles",
     "count": 512
    },
    {
     "value": "Musique classique",
     "count": 206
    },
    {
     "value": "Musiques classiques et savantes",
     "count": 91
    },
    {
     "value": "Musiques amplifiées ou électroniques",
     "count": 90
    },
    {
     "value": "Jazz, blues",
     "count": 88
    },
    {
     "value": "Musique",
     "count": 64
    },
    {
     "value": "Musiques du monde",
     "count": 48
    },
    {
     "value": "Musiques électroniques, techno",
     "count": 42
    },
    {
     "value": "Chanson ou variété française",
     "count": 39
    },
    {
     "value": "jazz, blues et musiques improvisées",
     "count": 38
    }
   ]
  },
  {
   "name": "Sous-catégorie Musique CNM",
   "format": "string",
   "type": "string",
   "distinct": 13,
   "missing": 6325,
   "tops": [
    {
     "value": "07- Musiques actuelles sans distinction",
     "count": 272
    },
    {
     "value": "02- Musiques amplifiées ou électroniques",
     "count": 209
    },
    {
     "value": "03- Jazz, blues et musiques improvisées",
     "count": 193
    },
    {
     "value": "11- Musique classique, lyrique, contemporaine, autres",
     "count": 66
    },
    {
     "value": "04- Musiques traditionnelles et du monde",
     "count": 60
    },
    {
     "value": "09- Pluridisciplinaire",
     "count": 50
    },
    {
     "value": "01- Chanson",
     "count": 49
    },
    {
     "value": "08- Musiques (sans distinction esthétique)",
     "count": 39
    },
    {
     "value": "15- Fête de la ville, feria, fête votive, fête de la pomme, etc.",
     "count": 10
    },
    {
     "value": "14- Autres disciplines culturelles (arts plastiques, cinéma, photographie, livre...)",
     "count": 4
    }
   ]
  },
  {
   "name": "Sous-catégorie cinéma et audiovisuel",
   "format": "string",
   "type": "string",
   "distinct": 176,
   "missing": 6785,
   "tops": [
    {
     "value": "Court métrage",
     "count": 45
    },
    {
     "value": "Court métrage, Documentaire, Fiction long métrage, Film d'animation",
     "count": 44
    },
    {
     "value": "Fiction long métrage",
     "count": 44
    },
    {
     "value": "Documentaire",
     "count": 39
    },
    {
     "value": "Fiction long métrage, Court métrage, Documentaire, Film d'animation",
     "count": 30
    },
    {
     "value": "Court métrage, Documentaire, Fiction long métrage",
     "count": 12
    },
    {
     "value": "Film d'animation",
     "count": 10
    },
    {
     "value": "Documentaire, Fiction long métrage",
     "count": 10
    },
    {
     "value": "Cinéma",
     "count": 9
    },
    {
     "value": "Court métrage, Fiction long métrage",
     "count": 9
    }
   ]
  },
  {
   "name": "Sous-catégorie arts visuels et arts numériques",
   "format": "string",
   "type": "string",
   "distinct": 149,
   "missing": 7003,
   "tops": [
    {
     "value": "Photographie",
     "count": 57
    },
    {
     "value": "Street art",
     "count": 14
    },
    {
     "value": "Arts visuels",
     "count": 10
    },
    {
     "value": "Street Art",
     "count": 9
    },
    {
     "value": "Arts numériques, Installation, Performance",
     "count": 8
    },
    {
     "value": "Peinture",
     "count": 8
    },
    {
     "value": "Architecture",
     "count": 7
    },
    {
     "value": "Arts numériques",
     "count": 7
    },
    {
     "value": "Sculpture",
     "count": 4
    },
    {
     "value": "Arts plastiques",
     "count": 3
    }
   ]
  },
  {
   "name": "Sous-catégorie livre et littérature",
   "format": "string",
   "type": "string",
   "distinct": 186,
   "missing": 6870,
   "tops": [
    {
     "value": "Bande dessinée, comics, manga",
     "count": 45
    },
    {
     "value": "Fiction",
     "count": 33
    },
    {
     "value": "Poésie",
     "count": 32
    },
    {
     "value": "Bande dessinée",
     "count": 21
    },
    {
     "value": "Polar",
     "count": 14
    },
    {
     "value": "Généraliste",
     "count": 14
    },
    {
     "value": "Conte",
     "count": 12
    },
    {
     "value": "Bande dessinée, comics, manga, fiction (roman, théâtre, etc.), Non-fiction (documentaire, autobiographie, essai, récit, etc.), Poésie, polar, science-fiction",
     "count": 9
    },
    {
     "value": "Jeunesse",
     "count": 9
    },
    {
     "value": "Fiction (roman, théâtre, etc.)",
     "count": 7
    }
   ]
  },
  {
   "name": "Période principale de déroulement du festival",
   "format": "string",
   "type": "string",
   "distinct": 22,
   "missing": 60,
   "tops": [
    {
     "value": "Saison (21 juin - 5 septembre)",
     "count": 2644
    },
    {
     "value": "Avant-saison (1er janvier - 20 juin)",
     "count": 2472
    },
    {
     "value": "Après-saison (6 septembre - 31 décembre)",
     "count": 1928
    },
    {
     "value": "saison (21 juin - 5 septembre)",
     "count": 59
    },
    {
     "value": "avant-saison (1er janvier - 20 juin)",
     "count": 26
    },
    {
     "value": "Octobre",
     "count": 19
    },
    {
     "value": "Novembre",
     "count": 14
    },
    {
     "value": "Décembre",
     "count": 10
    },
    {
     "value": "Mars",
     "count": 7
    },
    {
     "value": "après-saison (6 septembre - 31 décembre)",
     "count": 7
    }
   ]
  },
  {
   "name": "Identifiant Agence A",
   "format": "string",
   "type": "string",
   "distinct": 826,
   "missing": 6457,
   "tops": [
    {
     "value": "LA541",
     "count": 1
    },
    {
     "value": "LA480",
     "count": 1
    },
    {
     "value": "LA469",
     "count": 1
    },
    {
     "value": "LA279",
     "count": 1
    },
    {
     "value": "LA527",
     "count": 1
    },
    {
     "value": "LA70",
     "count": 1
    },
    {
     "value": "LA36",
     "count": 1
    },
    {
     "value": "CR205",
     "count": 1
    },
    {
     "value": "LA117",
     "count": 1
    },
    {
     "value": "LA126",
     "count": 1
    }
   ]
  },
  {
   "name": "Identifiant",
   "format": "string",
   "type": "string",
   "distinct": 7270,
   "missing": 0,
   "tops": [
    {
     "value": "FEST__7265",
     "count": 10
    },
    {
     "value": "FEST_98735_7265",
     "count": 5
    },
    {
     "value": "FEST_14327_2572",
     "count": 1
    },
    {
     "value": "FEST_31555_6625",
     "count": 1
    },
    {
     "value": "FEST_91174_1809",
     "count": 1
    },
    {
     "value": "FEST_59153_1788",
     "count": 1
    },
    {
     "value": "FEST_70162_1751",
     "count": 1
    },
    {
     "value": "FEST_60157_1660",
     "count": 1
    },
    {
     "value": "FEST_84035_1337",
     "count": 1
    },
    {
     "value": "FEST_06033_1290",
     "count": 1
    }
   ]
  },
  {
   "name": "Géocodage xy",
   "format": "latlon_wgs",
   "type": "string",
   "distinct": 3154,
   "missing": 33,
   "tops": [
    {
     "value": "48.8567, 2.3508",
     "count": 125
    },
    {
     "value": "43.296346, 5.369889",
     "count": 119
    },
    {
     "value": "43.5963814303, 1.43167293364",
     "count": 92
    },
    {
     "value": "48.1119791219, -1.68186449144",
     "count": 76
    },
    {
     "value": "48.5712679849, 7.76752679517",
     "count": 57
    },
    {
     "value": "43.6134409138, 3.86851657896",
     "count": 52
    },
    {
     "value": "50.6317183168, 3.04783272312",
     "count": 51
    },
    {
     "value": "43.9352448339, 4.84071572505",
     "count": 46
    },
    {
     "value": "47.2316356767, -1.54831008605",
     "count": 43
    },
    {
     "value": "44.8572445351, -0.57369678116",
     "count": 40
    }
   ]
  },
  {
   "name": "identifiant CNM",
   "format": "int",
   "type": "int",
   "distinct": 937,
   "missing": 6325,
   "min": 2,
   "max": 6108,
   "mean": 2244.669102296451,
   "std": 1792.4191303007672,
   "tops": [
    {
     "value": 5363,
     "count": 10
    },
    {
     "value": 3535,
     "count": 2
    },
    {
     "value": 1070,
     "count": 2
    },
    {
     "value": 5152,
     "count": 2
    },
    {
     "value": 5932,
     "count": 2
    },
    {
     "value": 2221,
     "count": 2
    },
    {
     "value": 1694,
     "count": 2
    },
    {
     "value": 3020,
     "count": 2
    },
    {
     "value": 236,
     "count": 2
    },
    {
     "value": 2013,
     "count": 2
    }
   ]
  }
 ],
 "rows": [
  {
   "Nom du festival": "Des Planches et des Vaches",
   "Envergure territoriale": null,
   "Région principale de déroulement": "Normandie",
   "Département principal de déroulement": "Calvados",
   "Commune principale de déroulement": "Hérouville-Saint-Clair",
   "Code postal (de la commune principale de déroulement)": "14200",
   "Code Insee commune": "14327",
   "Code Insee EPCI": "200065597",
   "Libellé EPCI": "CU Caen la Mer",
   "Numéro de voie": "1",
   "Type de voie (rue, Avenue, boulevard, etc.)": "Avenue",
   "Nom de la voie": "Haut Crépon",
   "Adresse postale": "1 Avenue  Haut Crépon",
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": "www.planchesetvaches.com",
   "Décennie de création du festival": "De 2000 à 2009",
   "Année de création du festival": "2002",
   "Discipline dominante": "Livre, littérature",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": "Bande dessinée, comics, manga",
   "Période principale de déroulement du festival": "Avant-saison (1er janvier - 20 juin)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_14327_2572",
   "Géocodage xy": "49.2073560619, -0.331022626025",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Festival celte en Gevaudan",
   "Envergure territoriale": "Régionale",
   "Région principale de déroulement": "Auvergne-Rhône-Alpes",
   "Département principal de déroulement": "Haute-Loire",
   "Commune principale de déroulement": "Saugues",
   "Code postal (de la commune principale de déroulement)": "43170",
   "Code Insee commune": "43234",
   "Code Insee EPCI": "200073393",
   "Libellé EPCI": "CC des Rives du Haut-Allier",
   "Numéro de voie": "1",
   "Type de voie (rue, Avenue, boulevard, etc.)": "Place",
   "Nom de la voie": "Place du breuil",
   "Adresse postale": "1 Place Place du breuil",
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": "www.festivalengevaudan.com",
   "Décennie de création du festival": "De 2000 à 2009",
   "Année de création du festival": "2007",
   "Discipline dominante": "Musique",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": "Musique celtique",
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Saison (21 juin - 5 septembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_43234_6254",
   "Géocodage xy": "44.9482034569, 3.53883236387",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Festival International de Châteauroux - DARC",
   "Envergure territoriale": "Interrégionale",
   "Région principale de déroulement": "Centre-Val de Loire",
   "Département principal de déroulement": "Indre",
   "Commune principale de déroulement": "Châteauroux",
   "Code postal (de la commune principale de déroulement)": "36000",
   "Code Insee commune": "36044",
   "Code Insee EPCI": "243600327",
   "Libellé EPCI": "CA Châteauroux Métropole",
   "Numéro de voie": "10 bis",
   "Type de voie (rue, Avenue, boulevard, etc.)": "Rue",
   "Nom de la voie": "Dauphine",
   "Adresse postale": "10 bis Rue Dauphine",
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": "www.danses-darc.com",
   "Décennie de création du festival": "Avant 1980",
   "Année de création du festival": "1976",
   "Discipline dominante": "Musique",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": "Chanson ou variété française, Jazz, blues, Hip-hop, rap, slam, Métal, hard rock, Musiques du monde, Musiques électroniques, techno, Musiques traditionnelles, Pop, rock, RnB, Variétés internationales, Compagnies de Danse",
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Saison (21 juin - 5 septembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_36044_1549",
   "Géocodage xy": "46.8029617828, 1.69399812001",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Contre-plongées de l'été",
   "Envergure territoriale": null,
   "Région principale de déroulement": "Auvergne-Rhône-Alpes",
   "Département principal de déroulement": "Puy-de-Dôme",
   "Commune principale de déroulement": "Clermont-Ferrand",
   "Code postal (de la commune principale de déroulement)": "63000",
   "Code Insee commune": "63113",
   "Code Insee EPCI": "246300701",
   "Libellé EPCI": "Clermont Auvergne Métropole",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": null,
   "Adresse postale": null,
   "Complément d'adresse (facultatif)": "Différents lieux :  Jardin Lecoq  Square Amadéo  Champratel Les Vergnes",
   "Site internet du festival": "https://www.clermontauvergnetourisme.com/magazine/patrimoine-culture/contre-plongees/",
   "Décennie de création du festival": "De 2000 à 2009",
   "Année de création du festival": null,
   "Discipline dominante": "Pluridisciplinaire",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Saison (21 juin - 5 septembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_63113_1668",
   "Géocodage xy": "45.7856492991, 3.11554542903",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Festival des Filets Bleus",
   "Envergure territoriale": null,
   "Région principale de déroulement": "Bretagne",
   "Département principal de déroulement": "Finistère",
   "Commune principale de déroulement": "Concarneau",
   "Code postal (de la commune principale de déroulement)": "29900",
   "Code Insee commune": "29039",
   "Code Insee EPCI": "242900769",
   "Libellé EPCI": "CA Concarneau Cornouaille Agglomération",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": "Parking CCI",
   "Adresse postale": "Parking CCI",
   "Complément d'adresse (facultatif)": "Quai Carnot",
   "Site internet du festival": "www.festivaldesfiletsbleus.bzh",
   "Décennie de création du festival": "Avant 1980",
   "Année de création du festival": "1905",
   "Discipline dominante": "Musique",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": "Chanson ou variété française, Musiques du monde, Musiques traditionnelles, Variétés internationales, Pop, rock",
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Saison (21 juin - 5 septembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_29039_1777",
   "Géocodage xy": "47.8966260003, -3.90716871821",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Mois du graphisme d'Echirolles",
   "Envergure territoriale": "Intercommunale",
   "Région principale de déroulement": "Auvergne-Rhône-Alpes",
   "Département principal de déroulement": "Isère",
   "Commune principale de déroulement": "Échirolles",
   "Code postal (de la commune principale de déroulement)": "38130",
   "Code Insee commune": "38151",
   "Code Insee EPCI": "200040715",
   "Libellé EPCI": "Grenoble-Alpes-Métropole",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": null,
   "Adresse postale": null,
   "Complément d'adresse (facultatif)": "entre du graphisme d'Échirolles",
   "Site internet du festival": "https://auvergnerhonealpes-livre-lecture.org/annuaires/manifestations/2257",
   "Décennie de création du festival": "De 1990 à 1999",
   "Année de création du festival": "1991",
   "Discipline dominante": "Arts visuels, arts numériques",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Après-saison (6 septembre - 31 décembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_38151_2080",
   "Géocodage xy": "45.1471647181, 5.71535600177",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Zinc Grenadine - Fête régionale du livre jeunesse",
   "Envergure territoriale": null,
   "Région principale de déroulement": "Grand Est",
   "Département principal de déroulement": "Vosges",
   "Commune principale de déroulement": "Épinal",
   "Code postal (de la commune principale de déroulement)": "88000",
   "Code Insee commune": "88160",
   "Code Insee EPCI": "200068757",
   "Libellé EPCI": "CA d'Epinal",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": null,
   "Adresse postale": null,
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": "www.zincgrenadine.fr",
   "Décennie de création du festival": "2010 et après",
   "Année de création du festival": "2011",
   "Discipline dominante": "Livre, littérature",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": "Fiction (roman, théâtre, etc.), Non-fiction (documentaire, autobiographie, essai, récit, etc.), Bande dessinée, comics, manga, Jeunesse, salon du livre",
   "Période principale de déroulement du festival": "Saison (21 juin - 5 septembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_88160_2119",
   "Géocodage xy": "48.1631202656, 6.47989286928",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Courants d’arts",
   "Envergure territoriale": null,
   "Région principale de déroulement": "Île-de-France",
   "Département principal de déroulement": "Val-de-Marne",
   "Commune principale de déroulement": "Gentilly",
   "Code postal (de la commune principale de déroulement)": "94250",
   "Code Insee commune": "94037",
   "Code Insee EPCI": "200058014",
   "Libellé EPCI": "Grand-Orly Seine Bièvre (T12)",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": null,
   "Adresse postale": null,
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": "www.lescourants.com",
   "Décennie de création du festival": null,
   "Année de création du festival": null,
   "Discipline dominante": "Pluridisciplinaire",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Avant-saison (1er janvier - 20 juin)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_94037_2380",
   "Géocodage xy": "48.8132044389, 2.34420659702",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Faveurs",
   "Envergure territoriale": "Communale",
   "Région principale de déroulement": "Provence-Alpes-Côte d'Azur",
   "Département principal de déroulement": "Var",
   "Commune principale de déroulement": "Hyères",
   "Code postal (de la commune principale de déroulement)": "83400",
   "Code Insee commune": "83069",
   "Code Insee EPCI": "248300543",
   "Libellé EPCI": "Métropole Toulon-Provence-Méditerranée",
   "Numéro de voie": "13",
   "Type de voie (rue, Avenue, boulevard, etc.)": "Cours",
   "Nom de la voie": "De strasbourg",
   "Adresse postale": "13 Cours De strasbourg",
   "Complément d'adresse (facultatif)": "1 rue racine - bp 5210 - 83 095 toulon cedex",
   "Site internet du festival": "https://faveursdeprintemps.com/",
   "Décennie de création du festival": "De 2000 à 2009",
   "Année de création du festival": "2003",
   "Discipline dominante": "Musique",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": "Pop, folk",
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Avant-saison (1er janvier - 20 juin)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_83069_2600",
   "Géocodage xy": "43.1018713534, 6.18898508469",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Salon du livre de la Pierre",
   "Envergure territoriale": "Intercommunale",
   "Région principale de déroulement": "Auvergne-Rhône-Alpes",
   "Département principal de déroulement": "Isère",
   "Commune principale de déroulement": "La Pierre",
   "Code postal (de la commune principale de déroulement)": "38570",
   "Code Insee commune": "38303",
   "Code Insee EPCI": "200018166",
   "Libellé EPCI": "CC Le Grésivaudan",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": null,
   "Adresse postale": null,
   "Complément d'adresse (facultatif)": "Salle des fêtes de la pierre",
   "Site internet du festival": "http://ombrehistoire.fr",
   "Décennie de création du festival": "De 2000 à 2009",
   "Année de création du festival": "2004",
   "Discipline dominante": "Livre, littérature",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Avant-saison (1er janvier - 20 juin)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_38303_2805",
   "Géocodage xy": "45.2948585917, 5.94144345331",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Soirs d'été",
   "Envergure territoriale": null,
   "Région principale de déroulement": "Pays de la Loire",
   "Département principal de déroulement": "Sarthe",
   "Commune principale de déroulement": "Le Mans",
   "Code postal (de la commune principale de déroulement)": "72000",
   "Code Insee commune": "72181",
   "Code Insee EPCI": "247200132",
   "Libellé EPCI": "CU Le Mans Métropole",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": "Hôtel de Ville - Place St-Pierre",
   "Adresse postale": "Hôtel de Ville - Place St-Pierre",
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": null,
   "Décennie de création du festival": "2010 et après",
   "Année de création du festival": "2018",
   "Discipline dominante": "Spectacle vivant",
   "Sous-catégorie spectacle vivant": "Cirque, Arts de la rue",
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Saison (21 juin - 5 septembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_72181_3132",
   "Géocodage xy": "47.9885256718, 0.200030493539",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "GPF Guadeloupe poésie festival",
   "Envergure territoriale": "Départementale",
   "Région principale de déroulement": "Guadeloupe",
   "Département principal de déroulement": "Guadeloupe",
   "Commune principale de déroulement": "Les Abymes",
   "Code postal (de la commune principale de déroulement)": "97139",
   "Code Insee commune": "97101",
   "Code Insee EPCI": "200018653",
   "Libellé EPCI": "CA Cap Excellence",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": null,
   "Adresse postale": null,
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": null,
   "Décennie de création du festival": "2010 et après",
   "Année de création du festival": null,
   "Discipline dominante": "Livre, littérature",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": "Poésie",
   "Période principale de déroulement du festival": "Variable selon les années",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_97101_3235",
   "Géocodage xy": "16.2727794035, -61.5017044974",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Prise Directe",
   "Envergure territoriale": "Intercommunale",
   "Région principale de déroulement": "Hauts-de-France",
   "Département principal de déroulement": "Nord",
   "Commune principale de déroulement": "Lille",
   "Code postal (de la commune principale de déroulement)": "59000",
   "Code Insee commune": "59350",
   "Code Insee EPCI": "200093201",
   "Libellé EPCI": "Métropole Européenne de Lille",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": "Place",
   "Nom de la voie": "Cadet Rousselle",
   "Adresse postale": "Place  Cadet Rousselle",
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": "https://www.prisedirecte-festival.fr",
   "Décennie de création du festival": "2010 et après",
   "Année de création du festival": "2012",
   "Discipline dominante": "Pluridisciplinaire",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Avant-saison (1er janvier - 20 juin)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_59350_3359",
   "Géocodage xy": "50.6317183168, 3.04783272312",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Le Sous-Marin",
   "Envergure territoriale": "Intercommunale",
   "Région principale de déroulement": "Pays de la Loire",
   "Département principal de déroulement": "Maine-et-Loire",
   "Commune principale de déroulement": "Loire-Authion",
   "Code postal (de la commune principale de déroulement)": "49140",
   "Code Insee commune": "49307",
   "Code Insee EPCI": "244900015",
   "Libellé EPCI": "CU Angers Loire Métropole",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": null,
   "Adresse postale": null,
   "Complément d'adresse (facultatif)": "Extérieur ( chapelle , lieu public et privé )",
   "Site internet du festival": "www.compagniedupoulpe.net",
   "Décennie de création du festival": "2010 et après",
   "Année de création du festival": "2020",
   "Discipline dominante": "Spectacle vivant",
   "Sous-catégorie spectacle vivant": "Théâtre",
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Saison (21 juin - 5 septembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_49307_3423",
   "Géocodage xy": "47.4219645317, -0.319673646947",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Clari'jazz festival",
   "Envergure territoriale": null,
   "Région principale de déroulement": "Occitanie",
   "Département principal de déroulement": "Haute-Garonne",
   "Commune principale de déroulement": "Marignac Lasclares",
   "Code postal (de la commune principale de déroulement)": "31430",
   "Code Insee commune": "31317",
   "Code Insee EPCI": "200068815",
   "Libellé EPCI": "CC CSur de Garonne",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": null,
   "Adresse postale": null,
   "Complément d'adresse (facultatif)": "Salle des fêtes Labastide-Clermont",
   "Site internet du festival": "https://www.clarijazz.com",
   "Décennie de création du festival": "2010 et après",
   "Année de création du festival": "2011",
   "Discipline dominante": "Musique",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": "jazz et de musiques du monde",
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Saison (21 juin - 5 septembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_31317_3661",
   "Géocodage xy": "43.3049878647, 1.10662037582",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Festival Libres regards",
   "Envergure territoriale": "Interrégionale",
   "Région principale de déroulement": "Bourgogne-Franche-Comté",
   "Département principal de déroulement": "Doubs",
   "Commune principale de déroulement": "Montbéliard",
   "Code postal (de la commune principale de déroulement)": "25200",
   "Code Insee commune": "25388",
   "Code Insee EPCI": "200065647",
   "Libellé EPCI": "CA Pays de Montbéliard Agglomération",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": null,
   "Adresse postale": null,
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": "http://festivallibresregards.com",
   "Décennie de création du festival": "2010 et après",
   "Année de création du festival": "2010",
   "Discipline dominante": "Cinéma, audiovisuel",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Avant-saison (1er janvier - 20 juin)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_25388_3998",
   "Géocodage xy": "47.5155169816, 6.79148147353",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Festival Quand on conte",
   "Envergure territoriale": null,
   "Région principale de déroulement": "Nouvelle-Aquitaine",
   "Département principal de déroulement": "Vienne",
   "Commune principale de déroulement": "Nouaillé-Maupertuis",
   "Code postal (de la commune principale de déroulement)": "86340",
   "Code Insee commune": "86180",
   "Code Insee EPCI": "200043628",
   "Libellé EPCI": "CC des Vallées du Clain",
   "Numéro de voie": "1",
   "Type de voie (rue, Avenue, boulevard, etc.)": "Rue",
   "Nom de la voie": "du stade",
   "Adresse postale": "1 Rue du stade",
   "Complément d'adresse (facultatif)": "Salle de La Passerelle",
   "Site internet du festival": "http://quandonconte.free.fr",
   "Décennie de création du festival": "De 1990 à 1999",
   "Année de création du festival": "1998",
   "Discipline dominante": "Spectacle vivant",
   "Sous-catégorie spectacle vivant": "conte",
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Avant-saison (1er janvier - 20 juin)",
   "Identifiant Agence A": "LA541",
   "Identifiant": "FEST_86180_4479",
   "Géocodage xy": "46.5052879632, 0.418002332762",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "La Corde Raide",
   "Envergure territoriale": "Départementale",
   "Région principale de déroulement": "Pays de la Loire",
   "Département principal de déroulement": "Loire-Atlantique",
   "Commune principale de déroulement": "Pont-Château",
   "Code postal (de la commune principale de déroulement)": "44160",
   "Code Insee commune": "44129",
   "Code Insee EPCI": "200000438",
   "Libellé EPCI": "CC du Pays de Pontchâteau Saint-Gildas-des-Bois",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": "Rue",
   "Nom de la voie": "du Port du Four",
   "Adresse postale": "Rue du Port du Four",
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": "www.festival-lacorderaide.fr",
   "Décennie de création du festival": "2010 et après",
   "Année de création du festival": "2017",
   "Discipline dominante": "Musique",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": "Musiques du monde, Pop, rock",
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Avant-saison (1er janvier - 20 juin)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_44129_5147",
   "Géocodage xy": "47.433636363, -2.09556089039",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "La ToulHoops",
   "Envergure territoriale": null,
   "Région principale de déroulement": "Occitanie",
   "Département principal de déroulement": "Haute-Garonne",
   "Commune principale de déroulement": "Ramonville-Saint-Agne",
   "Code postal (de la commune principale de déroulement)": "31520",
   "Code Insee commune": "31446",
   "Code Insee EPCI": "243100633",
   "Libellé EPCI": "CA du Sicoval",
   "Numéro de voie": "73",
   "Type de voie (rue, Avenue, boulevard, etc.)": "Chemin",
   "Nom de la voie": "de mange pommes",
   "Adresse postale": "73 Chemin de mange pommes",
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": "https://www.helloasso.com/associations/croco-fume/evenements/la-toulhoops-un-weekend-de-hoopdance-a-toulouse/1",
   "Décennie de création du festival": "2010 et après",
   "Année de création du festival": "2021",
   "Discipline dominante": "Spectacle vivant",
   "Sous-catégorie spectacle vivant": "Danse",
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Après-saison (6 septembre - 31 décembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_31446_5291",
   "Géocodage xy": "43.5441837911, 1.47782372823",
   "identifiant CNM": null
  },
  {
   "Nom du festival": "Rentrée des Arts Visuels",
   "Envergure territoriale": null,
   "Région principale de déroulement": "Bretagne",
   "Département principal de déroulement": "Ille-et-Vilaine",
   "Commune principale de déroulement": "Rennes",
   "Code postal (de la commune principale de déroulement)": "35000",
   "Code Insee commune": "35238",
   "Code Insee EPCI": "243500139",
   "Libellé EPCI": "Rennes Métropole",
   "Numéro de voie": null,
   "Type de voie (rue, Avenue, boulevard, etc.)": null,
   "Nom de la voie": "Jardin Saint-Georges",
   "Adresse postale": "Jardin Saint-Georges",
   "Complément d'adresse (facultatif)": null,
   "Site internet du festival": null,
   "Décennie de création du festival": "2010 et après",
   "Année de création du festival": null,
   "Discipline dominante": "Arts visuels, arts numériques",
   "Sous-catégorie spectacle vivant": null,
   "Sous-catégorie musique": null,
   "Sous-catégorie Musique CNM": null,
   "Sous-catégorie cinéma et audiovisuel": null,
   "Sous-catégorie arts visuels et arts numériques": null,
   "Sous-catégorie livre et littérature": null,
   "Période principale de déroulement du festival": "Saison (21 juin - 5 septembre)",
   "Identifiant Agence A": null,
   "Identifiant": "FEST_35238_5397",
   "Géocodage xy": "48.1119791219, -1.68186449144",
   "identifiant CNM": null
  }
 ],
 "_snapshot": "data.gouv.fr, taken 2026-09-27: the whole-file column counts, and the first 20 rows (the contact e-mail column left out). The offline copy this template ships with."
};

const FACTS = "// What the model reads: the dataset in a few lines — its description, and every column with what\n// data.gouv.fr counted over the WHOLE file — then five sample rows. The rows themselves stay here.\nconst d = inputs.in.find((v) => v && Array.isArray(v.columns)) || { columns: [], rows: [], dataset: {} };\nconst ds = d.dataset || {};\nconst lines = [];\nlines.push(\"Dataset: \" + (ds.title || \"?\") + (ds.organization ? \" (published by \" + ds.organization + \")\" : \"\"));\nif (ds.description) lines.push(\"Description: \" + ds.description.replace(/\\s+/g, \" \").slice(0, 600));\nlines.push(\"Rows in the whole file: \" + d.total + \". Columns: \" + d.columns.length + \".\");\nfor (const c of d.columns) {\n  let s = \"- \" + c.name + \" [\" + (c.format || c.type || \"?\") + \"]\";\n  if (d.total && c.missing != null) s += \", filled \" + Math.round(100 * (d.total - c.missing) / d.total) + \"%\";\n  if (c.distinct != null) s += \", \" + c.distinct + \" distinct values\";\n  if (c.min != null) s += \", from \" + c.min + \" to \" + c.max;\n  const tops = (c.tops || []).filter((t) => t.count > 1).slice(0, 5);\n  if (tops.length) s += \"; most common: \" + tops.map((t) => t.value + \" (\" + t.count + \")\").join(\", \");\n  lines.push(s);\n}\nlines.push(\"The first \" + Math.min(5, d.rows.length) + \" rows:\");\nfor (const r of d.rows.slice(0, 5)) lines.push(JSON.stringify(r));\nreturn lines.join(\"\\n\");";

const REPORT = "// The page: the model's reading in words, then the numbers — every one counted by data.gouv.fr\n// over the whole file, never by a model (a digit the model wrote becomes …).\nconst d = inputs.in.find((v) => v && Array.isArray(v.columns)) || { columns: [], dataset: {} };\nconst reading = String(inputs.in.find((v) => typeof v === \"string\") || \"\");\nconst ds = d.dataset || {};\nconst words = (s) => s.replace(/[0-9][0-9.,%]*/g, \"…\");\nconst cell = (s) => String(s == null ? \"\" : s).replace(/\\|/g, \"/\").replace(/\\s+/g, \" \").slice(0, 60);\nconst out = [\"# \" + (ds.title || \"A dataset\"), \"\"];\nout.push([ds.organization, ds.licence && \"licence \" + ds.licence, ds.updated && \"updated \" + ds.updated, ds.page].filter(Boolean).join(\" · \"));\nout.push(\"\", words(reading).trim(), \"\", \"## The columns\", \"\", \"Counted by data.gouv.fr over all \" + d.total + \" rows of the file.\", \"\");\nout.push(\"| Column | Kind | Filled | Distinct | Most common |\", \"|---|---|---|---|---|\");\nfor (const c of d.columns) {\n  const filled = d.total && c.missing != null ? Math.round(100 * (d.total - c.missing) / d.total) + \"%\" : \"\";\n  const common = c.min != null ? c.min + \" to \" + c.max\n    : (c.tops || []).filter((t) => t.count > 1).slice(0, 3).map((t) => cell(t.value) + \" (\" + t.count + \")\").join(\", \");\n  out.push(\"| \" + [cell(c.name), cell(c.format || c.type || \"\"), filled, c.distinct == null ? \"\" : c.distinct, common].join(\" | \") + \" |\");\n}\nreturn out.join(\"\\n\");";

const DRAW = "// Draws ONE column's most common values with the counts data.gouv.fr made over the WHOLE file. The\n// model only chose the column and the words; every bar and every number comes from the data.\nconst d = inputs.in.find((v) => v && Array.isArray(v.columns)) || { columns: [], dataset: {}, total: 0 };\nconst spec = inputs.in.find((v) => v && typeof v.column === \"string\") || {};\nconst charted = (c) => c && Array.isArray(c.tops) && c.tops.length > 1 && c.tops[0].count > 1;\nconst want = String(spec.column || \"\").trim().toLowerCase();\nlet col = d.columns.find((c) => c.name.toLowerCase() === want && charted(c));\nconst swapped = !col && !!want;\nif (!col) col = d.columns.filter(charted).sort((a, b) => (a.distinct || 99) - (b.distinct || 99))[0];\nif (!col) return '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"600\" height=\"80\"><text x=\"20\" y=\"45\" font-size=\"14\">No column of this table has repeated values to chart.</text></svg>';\nconst esc = (s) => String(s).replace(/[&<>\"]/g, (ch) => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\" }[ch]));\n// The model's WORDS never carry a number onto the chart: any digit it writes becomes an ellipsis.\nconst words = (s) => String(s || \"\").replace(/[0-9][0-9.,%]*/g, \"…\");\nconst wrap = (text, n) => {\n  const out = []; let line = \"\";\n  for (const w of String(text).split(/\\s+/)) {\n    if ((line + \" \" + w).trim().length > n) { out.push(line.trim()); line = w; } else line += \" \" + w;\n  }\n  if (line.trim()) out.push(line.trim());\n  return out;\n};\nconst bars = col.tops.map((t) => ({ label: String(t.value), n: t.count }));\nif (col.missing) bars.push({ label: \"(empty)\", n: col.missing, empty: true });\nconst W = 820, left = 250, barW = 440, rowH = 28, top = 110;\nconst max = Math.max(1, ...bars.map((b) => b.n));\nlet y = top;\nconst drawn = bars.map((b) => {\n  const w = Math.max(1, Math.round((b.n / max) * barW));\n  const label = b.label.length > 34 ? b.label.slice(0, 33) + \"…\" : b.label;\n  const g = '<text x=\"' + (left - 12) + '\" y=\"' + (y + 18) + '\" text-anchor=\"end\" font-size=\"13\" fill=\"#18181b\">' + esc(label) + \"</text>\"\n    + '<rect x=\"' + left + '\" y=\"' + (y + 5) + '\" width=\"' + w + '\" height=\"18\" rx=\"4\" fill=\"' + (b.empty ? \"#d4d4d8\" : \"#71717a\") + '\"/>'\n    + '<text x=\"' + (left + w + 8) + '\" y=\"' + (y + 19) + '\" font-size=\"12\" fill=\"#52525b\">' + b.n + \"</text>\";\n  y += rowH;\n  return g;\n}).join(\"\");\ny += 16;\nconst text = (x, size, fill, s) => '<text x=\"' + x + '\" y=\"' + y + '\" font-size=\"' + size + '\" fill=\"' + fill + '\">' + esc(s) + \"</text>\";\nlet tail = \"\";\nfor (const line of wrap(words(spec.insight), 100).slice(0, 3)) { y += 18; tail += text(24, 14, \"#18181b\", line); }\nif (swapped) { y += 22; tail += text(24, 12, \"#b45309\", \"The model chose \\u201c\" + spec.column + \"\\u201d, which has nothing to chart here: showing \" + col.name + \".\"); }\nconst some = col.distinct > col.tops.length ? \"the \" + col.tops.length + \" most common of \" + col.distinct + \" values · \" : \"\";\ny += 26; tail += text(24, 11, \"#a1a1aa\", \"data.gouv.fr · \" + ((d.dataset || {}).title || \"\") + \" · \" + some + \"rows per value, counted by data.gouv.fr over all \" + d.total + \" rows\");\nconst H = y + 16;\nreturn '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"' + W + '\" height=\"' + H + '\" viewBox=\"0 0 ' + W + \" \" + H + '\" font-family=\"Inter, system-ui, sans-serif\">'\n  + '<rect width=\"' + W + '\" height=\"' + H + '\" fill=\"#fafafa\"/>'\n  + '<text x=\"24\" y=\"40\" font-size=\"22\" font-weight=\"700\" fill=\"#18181b\">' + esc(words(spec.title) || col.name) + \"</text>\"\n  + '<text x=\"24\" y=\"66\" font-size=\"14\" fill=\"#52525b\">' + esc(words(spec.subtitle) || \"The most common values\") + \"</text>\"\n  // What the bars ARE, written by the code, whatever the model titled them: rows per value, never a sum.\n  + '<text x=\"24\" y=\"92\" font-size=\"12\" fill=\"#a1a1aa\">' + esc(\"How many rows have each \" + col.name + \" (not a sum of another column)\") + \"</text>\"\n  + drawn + tail + \"</svg>\";";

export default {
  id: 'analyse-a-dataset',
  title: 'Analyse a dataset',
  subtitle: 'Paste a data.gouv.fr link: data.gouv.fr counts, the code draws, a model explains in words and answers your question with a program.',
  needsFarm: 'one',
  generations: 3,
  doc: {
    lolgraph: 2,
    title: 'Analyse a dataset',
    view: { x: 16, y: 8, zoom: 0.4 },
    parts: [
      { id: 'd_title', type: 'title', x: 40, y: 24, w: 820, h: 100, settings: { text: 'Analyse a dataset', size: 'l' } },
      { id: 'd_sub', type: 'title', x: 40, y: 130, w: 1500, h: 80, settings: { text: 'Paste the link of a dataset from data.gouv.fr into Open data, write your question, press Run all.', size: 's' } },
      { id: 'd_how', type: 'sticky', x: 40, y: 240, w: 320, h: 760, settings: { colour: 'yellow', text: "How it works\n\n1. Open data: paste the link of any dataset from www.data.gouv.fr (copy it from the browser). The box reads its description, the counts data.gouv.fr made over the WHOLE file, and a sample of its rows. A copy of the festivals list ships with the template, so it also runs offline.\n2. Facts (code, folded): the dataset in a few lines, for the model.\n3. Read it: the model explains what the data is, what stands out, and which questions it can answer — in words, never numbers.\n4. The page (code): the model's reading, then a table of every column with data.gouv.fr's own counts.\n5. Choose the chart: the model picks the column that best answers your question; Draw (code) draws how many rows have each of its most common values (a count of rows, never a sum of another column — for sums, ask your own question in 6).\n6. Ask your own question: the model writes a small program; the Code box runs it over the sample of rows (its answer says how many rows it saw).\n\nChange the link or the question, press Run all. Every number you see was counted by data.gouv.fr or by the code, never by a model." } },
      { id: 'd_data', type: 'opendata', x: 400, y: 240, w: 340, h: 180, settings: { link: "https://www.data.gouv.fr/datasets/liste-des-festivals-en-france", rows: 200 }, value: { kind: 'json', data: SNAPSHOT } },
      { id: 'd_q', type: 'note', x: 400, y: 460, w: 340, h: 170, settings: { text: "Which kinds of festivals are the most common in France?", locked: false } },
      { id: 'd_facts', type: 'code', x: 800, y: 240, w: 340, h: 130, settings: { code: FACTS, about: 'The dataset in a few lines for the model: each column with data.gouv.fr\u2019s counts.', folded: true } },
      {
        id: 'd_read', type: 'ask', x: 800, y: 410, w: 340, h: 300,
        settings: {
          instruction: "Read the facts about this open dataset and write, for a curious person who has never seen it, in the language of the dataset’s title: ## What it is — two or three sentences: what one row is, who publishes it, what it covers. ## What stands out — three to five points from the columns: which values dominate, which columns are mostly empty, anything surprising. ## Questions worth asking — three questions this data can answer, each naming the columns that answer it. Never write a number: say most, few, about half, the largest… The numbers are in the table next to your text.",
          shape: 'text',
        },
      },
      {
        id: 'd_spec', type: 'ask', x: 800, y: 750, w: 340, h: 330,
        settings: {
          instruction: "Read your question and the facts, then choose ONE column to chart so the chart answers your question as well as it can: a column whose most common values are listed in the facts, written exactly as there. The chart shows HOW MANY ROWS have each of those values — it cannot add up another column — so title it as a count of rows (for example: how many festivals per region), never as a total of something else. Also write a short title, a subtitle, and an insight: one or two sentences about what the counts show. Never write a number anywhere — the chart draws the numbers itself.",
          shape: 'json',
          schema: "{\n  \"type\": \"object\",\n  \"properties\": {\n    \"column\": {\n      \"type\": \"string\"\n    },\n    \"title\": {\n      \"type\": \"string\"\n    },\n    \"subtitle\": {\n      \"type\": \"string\"\n    },\n    \"insight\": {\n      \"type\": \"string\"\n    }\n  },\n  \"required\": [\n    \"column\",\n    \"title\",\n    \"subtitle\",\n    \"insight\"\n  ]\n}",
        },
      },
      {
        id: 'd_code', type: 'ask', x: 800, y: 1120, w: 340, h: 300,
        settings: {
          instruction: "Write JavaScript for a Code box that answers your question from the data, using the facts to know the columns. inputs.in[0] is the dataset: { total, read, columns: [{ name, … }], rows: [{ <column name>: value, … }] }, and rows is a SAMPLE: the first read rows of total. Use the column names exactly as in the facts. Return a short markdown answer that starts with “In the first <read> rows of <total>:”.",
          shape: 'text',
          code: 'js',
        },
      },
      { id: 'd_report', type: 'code', x: 1200, y: 240, w: 340, h: 130, settings: { code: REPORT, about: 'The page: the model\u2019s reading, then every column with data.gouv.fr\u2019s counts.', folded: true } },
      { id: 'd_draw', type: 'code', x: 1200, y: 750, w: 340, h: 130, settings: { code: DRAW, about: 'Draws the chosen column\u2019s most common values with data.gouv.fr\u2019s counts.', folded: true } },
      { id: 'd_answer', type: 'code', x: 1200, y: 1120, w: 340, h: 130, settings: { code: '', about: 'Runs the program the model wrote over the sample of rows.', folded: true } },
      { id: 'd_view', type: 'preview', x: 1600, y: 240, w: 640, h: 470, settings: { mode: 'markdown' } },
      { id: 'd_chart', type: 'preview', x: 1600, y: 750, w: 640, h: 340, settings: { mode: 'svg' } },
      { id: 'd_answer_view', type: 'preview', x: 1600, y: 1120, w: 640, h: 300, settings: { mode: 'markdown' } },
    ],
    wires: [
      { from: 'd_data', to: 'd_facts', port: 'in' },
      { from: 'd_facts', to: 'd_read', port: 'in', label: 'the facts' },
      { from: 'd_data', to: 'd_report', port: 'in' },
      { from: 'd_read', to: 'd_report', port: 'in' },
      { from: 'd_report', to: 'd_view', port: 'content' },
      { from: 'd_facts', to: 'd_spec', port: 'in', label: 'the facts' },
      { from: 'd_q', to: 'd_spec', port: 'in', label: 'your question' },
      { from: 'd_data', to: 'd_draw', port: 'in' },
      { from: 'd_spec', to: 'd_draw', port: 'in' },
      { from: 'd_draw', to: 'd_chart', port: 'content' },
      { from: 'd_facts', to: 'd_code', port: 'in', label: 'the facts' },
      { from: 'd_q', to: 'd_code', port: 'in', label: 'your question' },
      { from: 'd_data', to: 'd_answer', port: 'in' },
      { from: 'd_code', to: 'd_answer', port: 'code' },
      { from: 'd_answer', to: 'd_answer_view', port: 'content' },
    ],
  },
};
