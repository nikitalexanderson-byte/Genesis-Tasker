import RU from '../texts.ru.json';
import { SECTOR_IDS, type SectorId } from '../registry';
import type { Predicate } from '../types';
export const SCENARIO_PHASES = ['onset', 'recurrence', 'turning'] as const;
export const SCENARIO_MECHANISMS = ['information', 'resources', 'dependency', 'boundary', 'pressure', 'values', 'form', 'rhythm'] as const;
export type ScenarioPhase = typeof SCENARIO_PHASES[number];
export type ScenarioMechanism = typeof SCENARIO_MECHANISMS[number];
export type ScenarioRecord = {
    id: string;
    sectorId: SectorId;
    mechanismId: ScenarioMechanism;
    phase: ScenarioPhase;
    title: string;
    required: Predicate[];
    exclusions: Predicate[];
    relevantFields: string[];
    development: string;
    fork: string;
    observableOutcome: string;
    alternative: string;
    example: string;
    counterexample: string;
    predictedOutcome: 'occurs' | 'does_not_occur';
    contentVersion: string;
    sourceRefs: string[];
};
// Each row describes a different mechanism in its particular domain, not a
// biography inferred from the cards. Columns: title, onset, repetition, fork,
// observable result, alternative. Phase predicates below distinguish episodes.
type Seed = readonly [
    string,
    string,
    string,
    string,
    string,
    string
];
const rows: Readonly<Record<SectorId, readonly Seed[]>> = {
    northwest: [
        [RU.text1103, RU.text1104, RU.text1105, RU.text1106, RU.text1107, RU.text1108],
        [RU.text1109, RU.text1110, RU.text1111, RU.text1112, RU.text1113, RU.text1114],
        [RU.text1115, RU.text1116, RU.text1117, RU.text1118, RU.text1119, RU.text1120],
        [RU.text1121, RU.text1122, RU.text1123, RU.text1124, RU.text1125, RU.text1126],
        [RU.text1127, RU.text1128, RU.text1129, RU.text1130, RU.text1131, RU.text1132],
        [RU.text1133, RU.text1134, RU.text1135, RU.text1136, RU.text1137, RU.text1138],
        [RU.text1139, RU.text1140, RU.text1141, RU.text1142, RU.text1143, RU.text1144],
        [RU.text1145, RU.text1146, RU.text1147, RU.text1148, RU.text1149, RU.text1150],
    ],
    north: [
        [RU.text1151, RU.text1152, RU.text1153, RU.text1154, RU.text1155, RU.text1156],
        [RU.text1157, RU.text1158, RU.text1159, RU.text1160, RU.text1161, RU.text1162],
        [RU.text1163, RU.text1164, RU.text1165, RU.text1166, RU.text1167, RU.text1168],
        [RU.text1169, RU.text1170, RU.text1171, RU.text1172, RU.text1173, RU.text1174],
        [RU.text1175, RU.text1176, RU.text1177, RU.text1178, RU.text1179, RU.text1180],
        [RU.text1181, RU.text1182, RU.text1183, RU.text1184, RU.text1185, RU.text1186],
        [RU.text1187, RU.text1188, RU.text1189, RU.text1190, RU.text1191, RU.text1192],
        [RU.text1193, RU.text1194, RU.text1195, RU.text1196, RU.text1197, RU.text1198],
    ],
    northeast: [
        [RU.text1199, RU.text1200, RU.text1201, RU.text1202, RU.text1203, RU.text1204],
        [RU.text1205, RU.text1206, RU.text1207, RU.text1208, RU.text1209, RU.text1210],
        [RU.text1211, RU.text1212, RU.text1213, RU.text1214, RU.text1215, RU.text1216],
        [RU.text1217, RU.text1218, RU.text1219, RU.text1220, RU.text1221, RU.text1222],
        [RU.text1223, RU.text1224, RU.text1225, RU.text1226, RU.text1227, RU.text1228],
        [RU.text1229, RU.text1230, RU.text1231, RU.text1232, RU.text1233, RU.text1234],
        [RU.text1235, RU.text1236, RU.text1237, RU.text1238, RU.text1239, RU.text1240],
        [RU.text1241, RU.text1242, RU.text1243, RU.text1244, RU.text1245, RU.text1246],
    ],
    west: [
        [RU.text1247, RU.text1248, RU.text1249, RU.text1250, RU.text1251, RU.text1252],
        [RU.text1253, RU.text1254, RU.text1255, RU.text1256, RU.text1257, RU.text1258],
        [RU.text1259, RU.text1260, RU.text1261, RU.text1262, RU.text1263, RU.text1264],
        [RU.text1265, RU.text1266, RU.text1267, RU.text1268, RU.text1269, RU.text1270],
        [RU.text1271, RU.text1272, RU.text1273, RU.text1274, RU.text1275, RU.text1276],
        [RU.text1277, RU.text1278, RU.text1279, RU.text1280, RU.text1281, RU.text1282],
        [RU.text1283, RU.text1284, RU.text1285, RU.text1286, RU.text1287, RU.text1288],
        [RU.text1289, RU.text1290, RU.text1291, RU.text1292, RU.text1293, RU.text1294],
    ],
    center: [
        [RU.text1295, RU.text1296, RU.text1297, RU.text1298, RU.text1299, RU.text1300],
        [RU.text0922, RU.text1301, RU.text1302, RU.text1303, RU.text1304, RU.text1305],
        [RU.text1306, RU.text1307, RU.text1308, RU.text1309, RU.text1310, RU.text1311],
        [RU.text1312, RU.text1313, RU.text1314, RU.text1315, RU.text1316, RU.text1317],
        [RU.text1318, RU.text1319, RU.text1320, RU.text1321, RU.text1322, RU.text1323],
        [RU.text1324, RU.text1325, RU.text1326, RU.text1327, RU.text1328, RU.text1329],
        [RU.text1330, RU.text1331, RU.text1332, RU.text1333, RU.text1334, RU.text1335],
        [RU.text1336, RU.text1337, RU.text1338, RU.text1339, RU.text1340, RU.text1341],
    ],
    east: [
        [RU.text1342, RU.text1343, RU.text1344, RU.text1345, RU.text1346, RU.text1347],
        [RU.text1348, RU.text1349, RU.text1350, RU.text1351, RU.text1352, RU.text1353],
        [RU.text1354, RU.text1355, RU.text1356, RU.text1357, RU.text1358, RU.text1359],
        [RU.text1360, RU.text1361, RU.text1362, RU.text1363, RU.text1364, RU.text1365],
        [RU.text1366, RU.text1367, RU.text1368, RU.text1369, RU.text1370, RU.text1371],
        [RU.text1372, RU.text1373, RU.text1374, RU.text1375, RU.text1376, RU.text1377],
        [RU.text1378, RU.text1379, RU.text1380, RU.text1381, RU.text1382, RU.text1383],
        [RU.text1384, RU.text1385, RU.text1386, RU.text1387, RU.text1388, RU.text1389],
    ],
    southwest: [
        [RU.text1390, RU.text1391, RU.text1392, RU.text1393, RU.text1394, RU.text1395],
        [RU.text1396, RU.text1397, RU.text1398, RU.text1399, RU.text1400, RU.text1401],
        [RU.text1402, RU.text1403, RU.text1404, RU.text1405, RU.text1406, RU.text1407],
        [RU.text1408, RU.text1409, RU.text1410, RU.text1411, RU.text1412, RU.text1413],
        [RU.text1414, RU.text1415, RU.text1416, RU.text1417, RU.text1418, RU.text1419],
        [RU.text1420, RU.text1421, RU.text1422, RU.text1423, RU.text1424, RU.text1425],
        [RU.text1426, RU.text1427, RU.text1428, RU.text1429, RU.text1430, RU.text1431],
        [RU.text1432, RU.text1433, RU.text1434, RU.text1435, RU.text1436, RU.text1437],
    ],
    south: [
        [RU.text1438, RU.text1439, RU.text1440, RU.text1441, RU.text1442, RU.text1443],
        [RU.text1444, RU.text1445, RU.text1446, RU.text1447, RU.text1448, RU.text1449],
        [RU.text1450, RU.text1451, RU.text1452, RU.text1453, RU.text1454, RU.text1455],
        [RU.text1456, RU.text1457, RU.text1458, RU.text1459, RU.text1460, RU.text1461],
        [RU.text1462, RU.text1463, RU.text1464, RU.text1465, RU.text1466, RU.text1467],
        [RU.text1468, RU.text1469, RU.text1470, RU.text1471, RU.text1472, RU.text1473],
        [RU.text1474, RU.text1475, RU.text1476, RU.text1477, RU.text1478, RU.text1479],
        [RU.text1480, RU.text1481, RU.text1482, RU.text1483, RU.text1484, RU.text1485],
    ],
    southeast: [
        [RU.text1486, RU.text1487, RU.text1488, RU.text1489, RU.text1490, RU.text1491],
        [RU.text0926, RU.text1492, RU.text1493, RU.text1494, RU.text1495, RU.text1496],
        [RU.text1497, RU.text1498, RU.text1499, RU.text1500, RU.text1501, RU.text1502],
        [RU.text1503, RU.text1504, RU.text1505, RU.text1506, RU.text1507, RU.text1508],
        [RU.text1509, RU.text1510, RU.text1511, RU.text1512, RU.text1513, RU.text1514],
        [RU.text1515, RU.text1516, RU.text1517, RU.text1518, RU.text1519, RU.text1520],
        [RU.text1521, RU.text1522, RU.text1523, RU.text1524, RU.text1525, RU.text1526],
        [RU.text1527, RU.text1528, RU.text1529, RU.text1530, RU.text1531, RU.text1532],
    ],
};
const yes = (field: string): Predicate => ({ field, operator: 'eq', value: true });
const no = (field: string): Predicate => ({ field, operator: 'eq', value: false });
const conditions: Readonly<Record<ScenarioMechanism, Predicate[]>> = {
    information: [no('direct_evidence'), yes('info_access')], resources: [no('resource_available'), yes('small_step_possible')],
    dependency: [yes('external_dependency'), yes('decision_owner_known')], boundary: [yes('voluntary_commitment'), no('nonnegotiable_constraint')],
    pressure: [yes('attempted_again'), no('previous_attempt_effect')], values: [yes('values_share_constraint'), yes('goal_is_own')],
    form: [yes('change_desired'), no('clear_scope')], rhythm: [yes('phase_known'), no('earliest_difference')],
};
const phaseConditions: Readonly<Record<ScenarioPhase, Predicate[]>> = { onset: [no('repetition_known')], recurrence: [yes('repetition_known'), yes('pattern_same_context')], turning: [yes('prior_exception')] };
export const SCENARIOS: readonly ScenarioRecord[] = SECTOR_IDS.flatMap(sectorId => rows[sectorId].flatMap((seed, index) => SCENARIO_PHASES.map((phase, phaseIndex) => {
    const mechanismId = SCENARIO_MECHANISMS[index], required = [...conditions[mechanismId], ...phaseConditions[phase]];
    return { id: `${sectorId}-${mechanismId}-${phase}`, sectorId, mechanismId, phase, title: seed[0], required,
        exclusions: [yes('immediate_danger'), no('outcome_not_known')], relevantFields: required.map(p => p.field),
        development: seed[phaseIndex + 1], fork: seed[3], observableOutcome: seed[4], alternative: seed[5],
        example: `${phase === 'onset' ? RU.text1533 : phase === 'recurrence' ? RU.text1534 : RU.text1535}: ${seed[phaseIndex + 1]}`,
        counterexample: seed[5], predictedOutcome: phase === 'recurrence' && ['resources', 'dependency', 'pressure', 'form', 'rhythm'].includes(mechanismId) ? 'does_not_occur' : 'occurs', contentVersion: 'aurora-scenarios-v1', sourceRefs: ['project:conditional-scenarios-v1'] };
})));
if (SCENARIOS.length !== 216 || new Set(SCENARIOS.map(s => s.id)).size !== 216)
    throw new Error('AURORA_SCENARIO_CATALOG_INCOMPLETE');
