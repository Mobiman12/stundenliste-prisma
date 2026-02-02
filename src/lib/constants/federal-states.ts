export type GermanFederalStateCode =
  | 'DE-BW'
  | 'DE-BY'
  | 'DE-BE'
  | 'DE-BB'
  | 'DE-HB'
  | 'DE-HH'
  | 'DE-HE'
  | 'DE-MV'
  | 'DE-NI'
  | 'DE-NW'
  | 'DE-RP'
  | 'DE-SL'
  | 'DE-SN'
  | 'DE-ST'
  | 'DE-SH'
  | 'DE-TH'
  | 'AT-1'
  | 'AT-2'
  | 'AT-3'
  | 'AT-4'
  | 'AT-5'
  | 'AT-6'
  | 'AT-7'
  | 'AT-8'
  | 'AT-9'
  | 'CH-AG'
  | 'CH-AI'
  | 'CH-AR'
  | 'CH-BE'
  | 'CH-BL'
  | 'CH-BS'
  | 'CH-FR'
  | 'CH-GE'
  | 'CH-GL'
  | 'CH-GR'
  | 'CH-JU'
  | 'CH-LU'
  | 'CH-NE'
  | 'CH-NW'
  | 'CH-OW'
  | 'CH-SG'
  | 'CH-SH'
  | 'CH-SO'
  | 'CH-SZ'
  | 'CH-TG'
  | 'CH-TI'
  | 'CH-UR'
  | 'CH-VD'
  | 'CH-VS'
  | 'CH-ZG'
  | 'CH-ZH';

export const FEDERAL_STATE_OPTIONS: { code: GermanFederalStateCode; label: string }[] = [
  { code: 'DE-BW', label: 'Baden-Württemberg' },
  { code: 'DE-BY', label: 'Bayern' },
  { code: 'DE-BE', label: 'Berlin' },
  { code: 'DE-BB', label: 'Brandenburg' },
  { code: 'DE-HB', label: 'Bremen' },
  { code: 'DE-HH', label: 'Hamburg' },
  { code: 'DE-HE', label: 'Hessen' },
  { code: 'DE-MV', label: 'Mecklenburg-Vorpommern' },
  { code: 'DE-NI', label: 'Niedersachsen' },
  { code: 'DE-NW', label: 'Nordrhein-Westfalen' },
  { code: 'DE-RP', label: 'Rheinland-Pfalz' },
  { code: 'DE-SL', label: 'Saarland' },
  { code: 'DE-SN', label: 'Sachsen' },
  { code: 'DE-ST', label: 'Sachsen-Anhalt' },
  { code: 'DE-SH', label: 'Schleswig-Holstein' },
  { code: 'DE-TH', label: 'Thüringen' },
  { code: 'AT-1', label: 'Burgenland' },
  { code: 'AT-2', label: 'Kärnten' },
  { code: 'AT-3', label: 'Niederösterreich' },
  { code: 'AT-4', label: 'Oberösterreich' },
  { code: 'AT-5', label: 'Salzburg' },
  { code: 'AT-6', label: 'Steiermark' },
  { code: 'AT-7', label: 'Tirol' },
  { code: 'AT-8', label: 'Vorarlberg' },
  { code: 'AT-9', label: 'Wien' },
  { code: 'CH-AG', label: 'Aargau' },
  { code: 'CH-AI', label: 'Appenzell Innerrhoden' },
  { code: 'CH-AR', label: 'Appenzell Ausserrhoden' },
  { code: 'CH-BE', label: 'Bern' },
  { code: 'CH-BL', label: 'Basel-Landschaft' },
  { code: 'CH-BS', label: 'Basel-Stadt' },
  { code: 'CH-FR', label: 'Freiburg' },
  { code: 'CH-GE', label: 'Genf' },
  { code: 'CH-GL', label: 'Glarus' },
  { code: 'CH-GR', label: 'Graubünden' },
  { code: 'CH-JU', label: 'Jura' },
  { code: 'CH-LU', label: 'Luzern' },
  { code: 'CH-NE', label: 'Neuenburg' },
  { code: 'CH-NW', label: 'Nidwalden' },
  { code: 'CH-OW', label: 'Obwalden' },
  { code: 'CH-SG', label: 'St. Gallen' },
  { code: 'CH-SH', label: 'Schaffhausen' },
  { code: 'CH-SO', label: 'Solothurn' },
  { code: 'CH-SZ', label: 'Schwyz' },
  { code: 'CH-TG', label: 'Thurgau' },
  { code: 'CH-TI', label: 'Tessin' },
  { code: 'CH-UR', label: 'Uri' },
  { code: 'CH-VD', label: 'Waadt' },
  { code: 'CH-VS', label: 'Wallis' },
  { code: 'CH-ZG', label: 'Zug' },
  { code: 'CH-ZH', label: 'Zürich' },
];
