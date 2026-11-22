# VECONI V242.1 — Tabelas de referência

Todos os intervalos usam mediana/mínimo/máximo. Tempos em ms, salvo onde indicado. Pequeno e grande referem-se à fixture de navegação. A tabela de abertura informa a quantidade de produtos no emulador.

## Abertura, rede e sincronização

| Perfil | Produtos | Etapa | n válido/total | ms med/mín/máx | FCP ms | Recursos | Transfer. kB | JS ms | Estilo+layout ms | Heap MB | Req. Auth/FS | Operações FS acumuladas | Docs FS acumulados | Pico listener FS | Tarefas longas acumuladas | Estado final |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Desktop claro | 25 | cold-login-screen | 5/5 | 332/316/537 | 120/112/284 | 238/238/238 | 1554/1554/1554 | 84/81/98 | 40/35/46 | 6/6/7 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | unauthenticated |
| Desktop claro | 25 | login-to-dashboard | 5/5 | 253/238/797 | 120/112/284 | 238/238/239 | 1554/1554/1554 | 73/71/98 | 65/62/94 | 9/9/9 | 11/10/11 | 4/0/4 | 26/0/26 | 4/4/4 | 0/0/1 | authorized |
| Desktop claro | 25 | initial-hydration | 5/5 | 10/7/240 | 120/112/284 | 239/239/239 | 1554/1554/1554 | 2/1/62 | 2/1/16 | 11/10/11 | 1/0/3 | 5/4/5 | 26/26/26 | 4/4/4 | 0/0/2 | authorized |
| Desktop claro | 25 | install-worker | 5/5 | 520/494/857 | 120/112/284 | 239/239/239 | 1554/1554/1554 | 201/198/214 | 86/78/127 | 10/10/13 | 6/4/6 | 11/11/11 | 77/77/77 | 4/4/4 | 1/1/3 | authorized |
| Desktop claro | 25 | warm-reload | 5/5 | 623/604/739 | 116/116/152 | 238/238/238 | 0/0/0 | 106/95/125 | 89/86/90 | 15/13/20 | 10/9/10 | 0/0/4 | 0/0/26 | 4/4/4 | 0/0/0 | authorized |
| Desktop claro | 25 | products-incremental | 5/5 | 228/194/366 | 116/116/152 | 238/238/238 | 0/0/0 | 74/64/137 | 42/36/50 | 13/9/17 | 4/3/7 | 6/6/7 | 52/52/52 | 4/4/4 | 1/1/1 | authorized |
| Mobile claro | 25 | cold-login-screen | 3/3 | 9540/9488/9608 | 2672/2620/2752 | 238/238/238 | 1554/1554/1554 | 464/433/505 | 345/297/351 | 7/6/7 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 3/3/4 | unauthenticated |
| Mobile claro | 25 | login-to-dashboard | 3/3 | 1963/1934/2480 | 2672/2620/2752 | 239/239/239 | 1554/1554/1554 | 506/498/551 | 374/370/408 | 9/9/10 | 10/10/10 | 0/0/5 | 0/0/26 | 4/4/4 | 9/9/10 | authorized |
| Mobile claro | 25 | initial-hydration | 3/3 | 52/38/785 | 2672/2620/2752 | 239/239/239 | 1554/1554/1554 | 5/2/264 | 10/8/93 | 10/10/10 | 1/1/3 | 5/5/6 | 26/26/51 | 4/4/4 | 12/9/14 | authorized |
| Mobile claro | 25 | install-worker | 3/3 | 1165/1150/1285 | 2672/2620/2752 | 239/239/239 | 1554/1554/1554 | 709/684/743 | 233/215/250 | 10/9/11 | 5/5/9 | 5/5/10 | 26/26/51 | 4/4/4 | 15/12/17 | authorized |
| Mobile claro | 25 | warm-reload | 3/3 | 2957/2934/3285 | 320/316/356 | 239/239/239 | 0/0/0 | 947/943/1076 | 459/451/523 | 8/8/10 | 8/8/8 | 0/0/0 | 0/0/0 | 4/4/4 | 11/10/16 | authorized |
| Mobile claro | 25 | products-incremental | 3/3 | 1621/1390/2380 | 320/316/356 | 239/239/239 | 0/0/0 | 637/534/710 | 248/224/290 | 11/10/12 | 8/8/8 | 12/12/13 | 77/77/77 | 4/4/4 | 21/17/22 | authorized |
| Mobile claro | 25 | offline-dashboard-route | 3/3 | 979/889/1386 | 320/316/356 | 240/240/241 | 0/0/0 | 550/501/809 | 351/318/449 | 10/9/10 | 4/4/4 | 14/14/15 | 77/77/77 | 4/4/4 | 25/22/28 | authorized |
| Mobile claro | 25 | resume-open-session-products | 3/3 | 1147/1133/1160 | 320/316/356 | 241/241/241 | 0/0/0 | 459/428/460 | 133/121/134 | 12/8/13 | 7/6/7 | 17/17/18 | 78/78/78 | 4/4/4 | 30/27/34 | authorized |
| Mobile claro | 25 | offline-reload | 3/3 | 1521/1509/1585 | 344/336/344 | 238/238/238 | 0/0/0 | 412/403/442 | 197/191/204 | 9/9/9 | 3/3/3 | 0/0/0 | 0/0/0 | 0/0/0 | 5/5/5 | network_error |
| Mobile claro | 25 | resume-session | 3/3 | 3017/2924/3132 | 316/312/328 | 239/239/239 | 0/0/0 | 966/930/1006 | 457/455/495 | 11/9/11 | 7/7/7 | 0/0/0 | 0/0/0 | 4/4/4 | 15/10/16 | authorized |
| Mobile claro | 25 | resume-products | 3/3 | 1236/1168/1330 | 316/312/328 | 239/239/239 | 0/0/0 | 549/508/575 | 206/206/211 | 9/8/12 | 7/6/8 | 12/11/13 | 27/27/27 | 4/4/4 | 19/19/21 | authorized |
| Mobile escuro | 25 | cold-login-screen | 3/3 | 9519/9509/9524 | 2624/2620/2724 | 238/238/238 | 1554/1554/1554 | 462/445/475 | 328/307/335 | 7/6/7 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 4/3/4 | unauthenticated |
| Mobile escuro | 25 | login-to-dashboard | 3/3 | 1965/1905/2426 | 2624/2620/2724 | 239/239/239 | 1554/1554/1554 | 531/478/611 | 369/365/378 | 9/9/9 | 10/10/12 | 0/0/0 | 0/0/0 | 4/4/4 | 9/9/10 | authorized |
| Mobile escuro | 25 | initial-hydration | 3/3 | 62/53/373 | 2624/2620/2724 | 239/239/239 | 1554/1554/1554 | 3/2/122 | 12/10/49 | 10/10/10 | 1/1/1 | 5/5/5 | 26/26/26 | 4/4/4 | 11/10/12 | authorized |
| Mobile escuro | 25 | install-worker | 3/3 | 1160/992/1275 | 2624/2620/2724 | 239/239/239 | 1554/1554/1554 | 682/573/733 | 263/212/267 | 10/9/10 | 5/2/5 | 5/5/6 | 26/26/26 | 4/4/4 | 15/13/16 | authorized |
| Mobile escuro | 25 | warm-reload | 3/3 | 3085/3071/3730 | 344/328/352 | 239/239/239 | 0/0/0 | 1025/1022/1243 | 482/471/566 | 8/8/11 | 8/8/10 | 0/0/0 | 0/0/0 | 4/4/4 | 10/10/15 | authorized |
| Mobile escuro | 25 | products-incremental | 3/3 | 1628/1485/2603 | 344/328/352 | 239/239/239 | 0/0/0 | 709/651/891 | 283/248/298 | 10/9/11 | 8/4/8 | 12/9/12 | 77/77/77 | 4/4/4 | 21/19/21 | authorized |
| Mobile escuro | 25 | offline-dashboard-route | 3/3 | 1084/916/1314 | 344/328/352 | 240/240/241 | 0/0/0 | 627/497/763 | 387/348/418 | 11/9/12 | 4/4/4 | 14/9/14 | 77/77/77 | 4/4/4 | 26/24/27 | authorized |
| Mobile escuro | 25 | offline-reload | 3/3 | 1570/1537/1585 | 364/332/380 | 238/238/238 | 0/0/0 | 420/417/425 | 203/197/216 | 10/9/11 | 3/3/3 | 0/0/0 | 0/0/0 | 0/0/0 | 5/5/5 | network_error |
| Mobile escuro | 25 | resume-session | 3/3 | 3069/3052/3647 | 324/316/364 | 239/239/239 | 0/0/0 | 1003/959/1152 | 494/475/575 | 9/9/12 | 7/7/8 | 0/0/5 | 0/0/26 | 4/4/4 | 13/10/17 | authorized |
| Mobile escuro | 25 | resume-products | 3/3 | 1346/1291/1511 | 324/316/364 | 239/239/239 | 0/0/0 | 576/556/701 | 229/220/261 | 9/9/10 | 7/6/8 | 13/13/13 | 27/27/52 | 4/4/4 | 19/17/23 | authorized |
| Mobile claro | 1200 | cold-login-screen | 3/3 | 9522/9465/9524 | 2616/2580/2764 | 238/238/238 | 1554/1554/1554 | 448/438/463 | 321/317/325 | 6/6/7 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 4/3/4 | unauthenticated |
| Mobile claro | 1200 | login-to-dashboard | 3/3 | 1952/1929/2439 | 2616/2580/2764 | 239/239/239 | 1554/1554/1554 | 527/500/604 | 371/370/371 | 9/9/10 | 9/9/11 | 0/0/0 | 0/0/0 | 4/4/4 | 10/8/11 | authorized |
| Mobile claro | 1200 | initial-hydration | 3/3 | 6128/6089/11029 | 2616/2580/2764 | 239/239/239 | 1554/1554/1554 | 616/606/1317 | 253/238/496 | 27/27/42 | 3/3/7 | 6/6/8 | 1226/1226/1226 | 4/4/4 | 18/16/23 | authorized |
| Mobile claro | 1200 | install-worker | 3/3 | 582/580/884 | 2616/2580/2764 | 239/239/239 | 1554/1554/1554 | 253/246/323 | 24/24/26 | 43/43/52 | 5/0/5 | 8/8/8 | 1226/1226/1226 | 4/4/4 | 21/19/27 | authorized |
| Mobile claro | 1200 | warm-reload | 3/3 | 3671/3666/3698 | 328/328/340 | 239/239/239 | 0/0/0 | 1167/1156/1217 | 502/495/505 | 26/25/26 | 8/8/10 | 0/0/0 | 0/0/0 | 4/4/4 | 10/10/11 | authorized |
| Mobile claro | 1200 | products-incremental | 3/3 | 11502/11312/11561 | 328/328/340 | 239/239/239 | 0/0/0 | 2118/2066/2554 | 462/391/501 | 38/37/68 | 13/12/13 | 13/13/13 | 1302/1302/1327 | 4/4/4 | 29/29/35 | authorized |

## Navegação local

| Rota | Perfil | Pequeno 1ª | Pequeno retorno | Grande 1ª | Grande retorno | DOM grande 1ª | Heap grande MB | Listeners DOM | JS grande 1ª | Estilo+layout grande 1ª | Tarefas ≥50 ms (grande 1ª) | n grande 1ª |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| vender | Desktop claro | 75/63/135 | 54/46/76 | 1785/1728/1791 | 1926/1687/2169 | 58641/58641/58641 | 32/24/32 | 783/783/783 | 842/820/855 | 744/715/882 | 2/2/2 | 3 |
| clientes | Desktop claro | 110/101/133 | 85/78/86 | 1257/1250/1271 | 275/261/283 | 2081/2081/2081 | 33/28/33 | 858/858/858 | 1044/1043/1168 | 62/60/68 | 1/1/1 | 3 |
| produtos | Desktop claro | 59/55/59 | 50/38/65 | 67/55/121 | 76/67/83 | 2521/2521/2521 | 33/28/33 | 1019/1019/1019 | 23/17/38 | 35/30/61 | 1/0/1 | 3 |
| historico | Desktop claro | 13/12/20 | 18/17/20 | 67/67/81 | 66/57/67 | 49/49/49 | 48/44/48 | 1048/1048/1048 | 54/53/69 | 7/6/9 | 1/1/1 | 3 |
| relatorios | Desktop claro | 46/45/56 | 17/11/18 | 178/171/220 | 69/60/75 | 290/290/290 | 53/48/53 | 1069/1069/1069 | 151/148/192 | 21/18/21 | 1/1/1 | 3 |
| financeiro | Desktop claro | 60/60/66 | 35/35/46 | 54/54/56 | 41/39/57 | 664/664/664 | 54/49/54 | 1091/1091/1091 | 5/4/5 | 29/27/30 | 0/0/0 | 3 |
| crm | Desktop claro | 26/22/65 | 15/11/23 | 26/26/29 | 26/25/34 | 224/224/224 | 32/32/53 | 1112/1112/1112 | 14/14/15 | 10/10/12 | 0/0/0 | 3 |
| renovacoes | Desktop claro | 21/14/32 | 15/9/16 | 18/18/23 | 16/11/19 | 86/86/86 | 32/32/53 | 1115/1115/1115 | 3/3/3 | 8/8/9 | 0/0/0 | 3 |
| cobrancas | Desktop claro | 12/11/13 | 12/11/12 | 15/12/18 | 11/11/17 | 76/76/76 | 33/33/54 | 1124/1124/1124 | 5/5/7 | 5/5/6 | 0/0/0 | 3 |
| consignados | Desktop claro | 11/10/11 | 12/10/12 | 11/7/12 | 11/11/11 | 4/4/4 | 33/33/54 | 1124/1124/1124 | 2/2/2 | 1/1/2 | 0/0/0 | 3 |
| equipe | Desktop claro | 12/11/12 | 11/11/12 | 14/12/23 | 11/10/12 | 64/64/64 | 33/33/54 | 1143/1143/1143 | 3/3/4 | 7/6/8 | 0/0/0 | 3 |
| campanhas | Desktop claro | 13/12/14 | 12/11/12 | 13/12/14 | 11/10/12 | 113/113/113 | 34/33/55 | 1153/1153/1153 | 4/3/4 | 8/7/8 | 0/0/0 | 3 |
| catalogo | Desktop claro | 10/8/12 | 11/11/11 | 10/9/11 | 11/10/12 | 5/5/5 | 34/30/34 | 1154/1154/1154 | 2/2/2 | 2/2/2 | 0/0/0 | 3 |
| pedidos | Desktop claro | 12/10/13 | 12/11/12 | 15/12/18 | 12/11/12 | 99/99/99 | 34/30/34 | 1158/1158/1158 | 2/2/4 | 7/6/8 | 0/0/0 | 3 |
| configuracoes | Desktop claro | 11/11/11 | 11/10/12 | 17/12/19 | 12/11/12 | 153/153/153 | 34/30/34 | 1172/1172/1172 | 4/3/4 | 6/5/7 | 0/0/0 | 3 |
| planos | Desktop claro | 14/14/22 | 11/11/12 | 18/12/19 | 12/12/16 | 94/94/94 | 34/30/34 | 1177/1177/1177 | 4/3/6 | 8/6/8 | 0/0/0 | 3 |
| cupons | Desktop claro | 9/8/9 | 10/8/11 | 11/11/12 | 11/11/11 | 8/8/8 | 34/30/35 | 1178/1178/1178 | 2/2/2 | 2/2/2 | 0/0/0 | 3 |
| inicio | Desktop claro | 25/24/27 | 23/23/25 | 78/67/80 | 73/70/80 | 567/567/567 | 44/40/45 | 1228/1228/1228 | 59/54/61 | 11/10/13 | 1/1/1 | 3 |
| vender | Mobile claro | 298/264/319 | 289/256/326 | 7275/6609/8360 | 11884/11440/12445 | 40600/40600/40600 | 23/23/24 | 751/751/751 | 2811/2636/3519 | 4392/3882/6208 | 4/4/5 | 3 |
| clientes | Mobile claro | 564/533/605 | 281/278/359 | 7062/6571/7256 | 564/564/708 | 1452/1452/1452 | 36/36/37 | 913/913/913 | 6131/5740/6477 | 467/450/510 | 2/2/2 | 3 |
| produtos | Mobile claro | 352/339/366 | 95/85/134 | 445/419/480 | 100/99/114 | 1758/1758/1758 | 42/42/43 | 1086/1086/1086 | 129/125/146 | 254/238/268 | 2/2/2 | 3 |
| historico | Mobile claro | 71/68/166 | 43/35/46 | 280/277/306 | 252/247/255 | 49/49/49 | 30/29/37 | 1211/954/1211 | 238/236/258 | 32/32/39 | 1/1/1 | 3 |
| relatorios | Mobile claro | 335/323/656 | 75/65/81 | 1007/965/1166 | 367/347/376 | 287/287/287 | 37/36/42 | 1232/957/1232 | 815/778/950 | 177/172/201 | 1/1/1 | 3 |
| financeiro | Mobile claro | 329/291/505 | 214/195/216 | 303/300/319 | 250/225/281 | 664/664/664 | 38/37/43 | 1254/979/1254 | 28/28/29 | 181/179/191 | 2/2/2 | 3 |
| crm | Mobile claro | 199/181/206 | 130/125/137 | 6704/5801/6750 | 6764/6468/6897 | 112/112/112 | 42/37/56 | 1039/990/1265 | 6066/5708/6198 | 69/65/70 | 2/2/2 | 3 |
| renovacoes | Mobile claro | 61/55/70 | 40/38/41 | 60/59/67 | 42/39/46 | 86/86/86 | 37/27/42 | 1042/876/1268 | 16/15/16 | 26/24/27 | 0/0/0 | 3 |
| cobrancas | Mobile claro | 61/50/78 | 29/28/29 | 61/61/77 | 39/38/72 | 76/76/76 | 37/28/43 | 1051/871/1277 | 21/20/24 | 35/34/43 | 0/0/0 | 3 |
| consignados | Mobile claro | 20/18/23 | 17/16/17 | 20/18/24 | 19/17/38 | 4/4/4 | 38/28/43 | 1051/871/1277 | 10/10/13 | 5/5/7 | 0/0/0 | 3 |
| equipe | Mobile claro | 60/55/61 | 30/30/31 | 64/59/71 | 37/36/59 | 64/64/64 | 38/28/43 | 890/837/1296 | 20/18/27 | 38/36/38 | 0/0/0 | 3 |
| campanhas | Mobile claro | 71/70/92 | 38/36/40 | 76/76/85 | 46/44/57 | 113/113/113 | 38/29/43 | 906/838/1312 | 18/18/19 | 51/51/58 | 1/1/1 | 3 |
| catalogo | Mobile claro | 21/19/27 | 17/16/17 | 24/20/25 | 19/19/27 | 5/5/5 | 38/29/44 | 907/835/1313 | 11/9/13 | 7/6/7 | 0/0/0 | 3 |
| pedidos | Mobile claro | 57/51/58 | 33/30/34 | 55/55/62 | 38/37/71 | 99/99/99 | 39/29/44 | 911/839/1317 | 14/14/15 | 35/34/40 | 0/0/0 | 3 |
| configuracoes | Mobile claro | 75/63/78 | 33/33/34 | 64/60/72 | 44/41/66 | 153/153/153 | 39/29/44 | 925/853/1331 | 16/15/23 | 36/31/39 | 0/0/0 | 3 |
| planos | Mobile claro | 60/52/65 | 38/37/41 | 58/54/68 | 44/39/72 | 94/94/94 | 39/30/44 | 930/858/1336 | 18/18/26 | 33/29/34 | 0/0/0 | 3 |
| cupons | Mobile claro | 22/18/23 | 20/20/21 | 20/19/21 | 23/21/42 | 8/8/8 | 39/30/44 | 931/859/1337 | 9/8/9 | 8/6/8 | 0/0/0 | 3 |
| inicio | Mobile claro | 76/68/87 | 61/60/63 | 153/140/156 | 278/153/1035 | 245/245/245 | 47/38/53 | 940/868/1346 | 112/106/114 | 30/25/30 | 1/1/1 | 3 |
| vender | Mobile escuro | 298/293/311 | 300/279/339 | 6870/6803/8044 | 10336/10116/11833 | 40600/40600/40600 | 23/23/23 | 754/751/754 | 2785/2595/2807 | 5162/4159/5284 | 4/4/5 | 3 |
| clientes | Mobile escuro | 573/543/575 | 294/291/294 | 6503/6447/6521 | 543/543/618 | 1452/1452/1452 | 36/36/36 | 913/913/913 | 5672/5603/5794 | 458/414/473 | 2/2/2 | 3 |
| produtos | Mobile escuro | 373/313/389 | 91/80/105 | 453/436/494 | 99/94/99 | 1758/1758/1758 | 42/28/42 | 1086/1086/1086 | 145/124/152 | 251/240/282 | 2/2/2 | 3 |
| historico | Mobile escuro | 70/67/73 | 57/37/71 | 286/272/290 | 245/240/245 | 49/49/49 | 29/29/42 | 1211/925/1211 | 243/234/247 | 31/29/33 | 1/1/1 | 3 |
| relatorios | Mobile escuro | 331/305/332 | 77/65/81 | 994/932/1021 | 319/304/323 | 287/287/287 | 37/37/47 | 1232/946/1232 | 807/752/830 | 175/166/175 | 1/1/1 | 3 |
| financeiro | Mobile escuro | 293/291/316 | 216/203/217 | 324/276/376 | 204/204/231 | 664/664/664 | 38/38/48 | 1254/968/1254 | 27/24/32 | 198/168/233 | 2/2/2 | 3 |
| crm | Mobile escuro | 194/188/195 | 125/122/143 | 6368/6156/6771 | 6226/6164/6286 | 112/112/112 | 36/36/46 | 1265/979/1265 | 5877/5690/6030 | 65/61/68 | 2/2/2 | 3 |
| renovacoes | Mobile escuro | 60/53/64 | 34/34/38 | 54/51/59 | 38/38/42 | 86/86/86 | 37/36/46 | 1268/982/1268 | 16/14/17 | 23/23/25 | 0/0/0 | 3 |
| cobrancas | Mobile escuro | 62/58/65 | 27/26/31 | 63/63/68 | 37/35/39 | 76/76/76 | 37/37/47 | 1277/991/1277 | 22/20/23 | 37/36/38 | 0/0/0 | 3 |
| consignados | Mobile escuro | 21/20/22 | 15/15/16 | 19/18/22 | 16/16/20 | 4/4/4 | 37/37/47 | 1277/991/1277 | 10/10/12 | 5/4/5 | 0/0/0 | 3 |
| equipe | Mobile escuro | 66/63/69 | 31/31/33 | 67/64/73 | 31/31/34 | 64/64/64 | 38/37/47 | 1296/1010/1296 | 23/21/27 | 39/35/40 | 0/0/0 | 3 |
| campanhas | Mobile escuro | 77/76/86 | 37/36/39 | 80/73/82 | 41/41/42 | 113/113/113 | 38/38/48 | 1312/1026/1312 | 18/18/20 | 54/48/55 | 1/1/1 | 3 |
| catalogo | Mobile escuro | 22/21/26 | 16/16/18 | 22/20/23 | 20/19/22 | 5/5/5 | 38/38/48 | 1313/1027/1313 | 9/9/11 | 6/6/7 | 0/0/0 | 3 |
| pedidos | Mobile escuro | 55/54/57 | 31/30/33 | 54/53/59 | 34/33/37 | 99/99/99 | 38/38/48 | 1317/1031/1317 | 14/12/14 | 34/34/38 | 0/0/0 | 3 |
| configuracoes | Mobile escuro | 63/60/65 | 35/34/35 | 60/57/70 | 36/36/38 | 153/153/153 | 38/38/48 | 1331/1045/1331 | 15/14/17 | 34/33/40 | 0/0/0 | 3 |
| planos | Mobile escuro | 56/56/56 | 39/38/41 | 55/53/65 | 40/38/44 | 94/94/94 | 39/38/49 | 1336/1050/1336 | 18/17/23 | 29/29/33 | 0/0/0 | 3 |
| cupons | Mobile escuro | 20/19/21 | 19/19/22 | 27/22/290 | 21/20/23 | 8/8/8 | 39/27/49 | 1337/1051/1337 | 12/9/50 | 9/8/9 | 0/0/1 | 3 |
| inicio | Mobile escuro | 74/72/74 | 66/62/73 | 155/154/163 | 145/139/158 | 245/245/245 | 35/28/47 | 1162/1060/1346 | 111/108/121 | 32/30/37 | 1/1/1 | 3 |

## Interações locais

| Ação | Perfil | Volume | ms med/mín/máx | n válido/total | Falhas |
| --- | --- | --- | --- | --- | --- |
| vender-busca | Desktop claro | small | 156/152/310 | 3/3 | — |
| venda-adicionar | Desktop claro | small | 21/20/25 | 3/3 | — |
| venda-carrinho | Desktop claro | small | 16/16/16 | 3/3 | — |
| venda-etapa-pagamento | Desktop claro | small | 20/12/101 | 3/3 | — |
| venda-selecionar-pagamento | Desktop claro | small | 20/19/121 | 3/3 | — |
| clientes-busca | Desktop claro | small | 211/207/232 | 3/3 | — |
| clientes-busca-sem-resultados | Desktop claro | small | — | 0/3 | estado vazio nao confirmado |
| produtos-busca | Desktop claro | small | 35/32/40 | 3/3 | — |
| produtos-ordenar | Desktop claro | small | — | 0/3 | controle indisponivel |
| produtos-filtrar | Desktop claro | small | — | 0/3 | controle indisponivel |
| vender-busca | Desktop claro | large | 400/377/410 | 3/3 | — |
| venda-adicionar | Desktop claro | large | 362/303/452 | 3/3 | — |
| venda-carrinho | Desktop claro | large | 60/56/62 | 3/3 | — |
| venda-etapa-pagamento | Desktop claro | large | 61/37/93 | 3/3 | — |
| venda-selecionar-pagamento | Desktop claro | large | 334/314/414 | 3/3 | — |
| clientes-busca | Desktop claro | large | 225/223/274 | 3/3 | — |
| clientes-busca-sem-resultados | Desktop claro | large | — | 0/3 | estado vazio nao confirmado |
| produtos-busca | Desktop claro | large | 36/32/47 | 3/3 | — |
| produtos-ordenar | Desktop claro | large | — | 0/3 | controle indisponivel |
| produtos-filtrar | Desktop claro | large | — | 0/3 | controle indisponivel |
| vender-busca | Mobile claro | small | 184/168/230 | 3/3 | — |
| venda-adicionar | Mobile claro | small | 80/71/88 | 3/3 | — |
| venda-carrinho | Mobile claro | small | 126/116/164 | 3/3 | — |
| venda-selecionar-pagamento | Mobile claro | small | 100/96/118 | 3/3 | — |
| clientes-busca | Mobile claro | small | 436/435/436 | 3/3 | — |
| clientes-busca-sem-resultados | Mobile claro | small | — | 0/3 | estado vazio nao confirmado |
| produtos-busca | Mobile claro | small | 395/388/471 | 3/3 | — |
| produtos-ordenar | Mobile claro | small | 351/273/477 | 3/3 | — |
| produtos-filtrar | Mobile claro | small | 88/87/164 | 3/3 | — |
| vender-busca | Mobile claro | large | 1378/1093/1407 | 3/3 | — |
| venda-adicionar | Mobile claro | large | 1316/1140/1423 | 3/3 | — |
| venda-carrinho | Mobile claro | large | 812/751/866 | 3/3 | — |
| venda-selecionar-pagamento | Mobile claro | large | 2186/1956/2295 | 3/3 | — |
| clientes-busca | Mobile claro | large | 488/469/502 | 3/3 | — |
| clientes-busca-sem-resultados | Mobile claro | large | — | 0/3 | estado vazio nao confirmado |
| produtos-busca | Mobile claro | large | 427/406/433 | 3/3 | — |
| produtos-ordenar | Mobile claro | large | 374/370/375 | 3/3 | — |
| produtos-filtrar | Mobile claro | large | 87/81/91 | 3/3 | — |
| vender-busca | Mobile escuro | small | 187/162/235 | 3/3 | — |
| venda-adicionar | Mobile escuro | small | 83/72/94 | 3/3 | — |
| venda-carrinho | Mobile escuro | small | 124/116/127 | 3/3 | — |
| venda-selecionar-pagamento | Mobile escuro | small | 102/89/106 | 3/3 | — |
| clientes-busca | Mobile escuro | small | 442/427/455 | 3/3 | — |
| clientes-busca-sem-resultados | Mobile escuro | small | — | 0/3 | estado vazio nao confirmado |
| produtos-busca | Mobile escuro | small | 400/398/409 | 3/3 | — |
| produtos-ordenar | Mobile escuro | small | 331/281/366 | 3/3 | — |
| produtos-filtrar | Mobile escuro | small | 82/81/84 | 3/3 | — |
| vender-busca | Mobile escuro | large | 1123/1107/1165 | 3/3 | — |
| venda-adicionar | Mobile escuro | large | 1127/1124/1129 | 3/3 | — |
| venda-carrinho | Mobile escuro | large | 730/693/739 | 3/3 | — |
| venda-selecionar-pagamento | Mobile escuro | large | 1875/1864/1906 | 3/3 | — |
| clientes-busca | Mobile escuro | large | 493/476/505 | 3/3 | — |
| clientes-busca-sem-resultados | Mobile escuro | large | — | 0/3 | estado vazio nao confirmado |
| produtos-busca | Mobile escuro | large | 426/395/432 | 3/3 | — |
| produtos-ordenar | Mobile escuro | large | 361/345/393 | 3/3 | — |
| produtos-filtrar | Mobile escuro | large | 83/73/88 | 3/3 | — |

## IndexedDB e imagens

| Perfil | Volume | n | Gravar base ms | Alterar 1 ms | Reabrir ms | Processar JPEG ms | Gravar Cache Storage ms | Ler 1 imagem ms | Linhas | Itens IDB alterados |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Desktop claro | small | 3 | 13/11/17 | 6/4/7 | 6/6/7 | 222/213/227 | 19/17/27 | 1/1/2 | 162/162/162 | 1/1/1 |
| Desktop claro | large | 3 | 668/642/706 | 222/211/224 | 219/213/250 | 218/218/219 | 132/122/155 | 0/0/1 | 10642/10642/10642 | 1/1/1 |
| Mobile claro | small | 3 | 38/36/41 | 18/16/44 | 16/16/21 | 270/247/272 | 19/18/20 | 1/1/1 | 162/162/162 | 1/1/1 |
| Mobile claro | large | 3 | 2646/2183/2717 | 1012/1009/1026 | 711/711/916 | 258/257/266 | 137/130/142 | 1/1/2 | 10642/10642/10642 | 1/1/1 |
| Mobile escuro | small | 3 | 39/38/40 | 18/18/19 | 15/14/15 | 257/253/264 | 19/19/20 | 1/1/1 | 162/162/162 | 1/1/1 |
| Mobile escuro | large | 3 | 2340/2290/2352 | 1033/962/1049 | 675/654/684 | 261/245/268 | 139/117/144 | 1/1/2 | 10642/10642/10642 | 1/1/1 |

## Falhas de execução ou observação

| Origem | Perfil | Caso | Ocorrências | Erro |
| --- | --- | --- | --- | --- |
| Fixture | Mobile claro | clientes small first | 2 | ReferenceError: scoped is not defined |
| Fixture | Mobile claro | clientes large first | 3 | ReferenceError: scoped is not defined |
| Fixture | Mobile escuro | clientes small first | 3 | ReferenceError: scoped is not defined |
| Fixture | Mobile escuro | clientes large first | 3 | ReferenceError: scoped is not defined |

## Checkout e relatório em Firestore Emulator

| Perfil | Operação | ms med/mín/máx | n válido/total |
| --- | --- | --- | --- |
| Mobile | executar-servico | 99/83/105 | 3/3 |
| Mobile | servico-para-carrinho | 280/226/343 | 3/3 |
| Mobile | concluir-ate-recibo-local | 380/343/385 | 3/3 |
| Mobile | drenar-ate-confirmacao-com-retentativa | 387/387/394 | 3/3 |
| Mobile | relatorio-ate-resposta-confirmada | 536/522/540 | 3/3 |
| Desktop | executar-servico | 17/16/19 | 3/3 |
| Desktop | servico-para-carrinho | 51/39/52 | 3/3 |
| Desktop | concluir-ate-recibo-local | 114/113/114 | 3/3 |
| Desktop | drenar-ate-confirmacao-com-retentativa | 386/383/391 | 3/3 |
| Desktop | relatorio-ate-resposta-confirmada | 173/161/185 | 3/3 |

## Movimento no Início mobile

| Preferência | n | Animações iniciadas | Recálculo de estilos ms após a montagem |
| --- | --- | --- | --- |
| no-preference | 3 | 20/20/20 | 227/221/232 |
| reduce | 3 | 0/0/0 | 0/0/0 |
