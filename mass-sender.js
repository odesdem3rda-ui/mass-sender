/*
 * Ataque Aleatório - Tribal Wars
 * Escolhes um grupo das tuas aldeias + uma lista de coordenadas alvo.
 * O script cria 1 comando por aldeia (alvo aleatório), com TODAS as tropas,
 * e abre separadores na praça de reuniões já preenchidos.
 * Só falta carregar em "Enviar ataque" em cada separador.
 *
 * Uso: javascript: $.getScript('URL_DO_TEU_FICHEIRO.js');
 */
(function () {
    'use strict';

    if (typeof game_data === 'undefined' || game_data.screen === undefined) {
        alert('Corre este script dentro do jogo.');
        return;
    }

    var ID = 'ataque-aleatorio-box';
    if (document.getElementById(ID)) {
        document.getElementById(ID).remove();
    }

    var state = { plan: [], opened: 0 };

    // ---------- UI ----------
    var box = document.createElement('div');
    box.id = ID;
    box.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);width:560px;max-height:85vh;overflow:auto;' +
        'z-index:99999;background:#f4e4bc;border:2px solid #7d510f;padding:10px;font-size:12px;box-shadow:0 0 12px #000;';
    box.innerHTML =
        '<h3 style="margin:0 0 8px 0;">Ataque Aleatório <span id="aa-close" style="float:right;cursor:pointer;">[x]</span></h3>' +
        '<table class="vis" style="width:100%">' +
        '<tr><td>Grupo de aldeias</td><td><select id="aa-group" style="width:200px"><option>A carregar...</option></select></td></tr>' +
        '<tr><td>Ataques por botão</td><td><input id="aa-per" type="number" value="5" min="1" style="width:60px"></td></tr>' +
        '<tr><td>Atraso ao abrir separadores (ms)</td><td><input id="aa-delay" type="number" value="250" min="0" style="width:60px"></td></tr>' +
        '<tr><td>Coordenadas alvo<br><small>(formato 500|500, separadas por espaço ou linha)</small></td>' +
        '<td><textarea id="aa-coords" rows="6" style="width:98%"></textarea></td></tr>' +
        '</table>' +
        '<p style="margin:8px 0;"><button id="aa-calc" class="btn">Calcular ataques</button></p>' +
        '<div id="aa-info" style="margin:6px 0;"></div>' +
        '<div id="aa-buttons"></div>' +
        '<div id="aa-list" style="margin-top:8px;max-height:200px;overflow:auto;"></div>';
    document.body.appendChild(box);

    function $id(i) { return document.getElementById(i); }
    $id('aa-close').onclick = function () { box.remove(); };

    // ---------- Grupos ----------
    function fillGroups(list) {
        var sel = $id('aa-group');
        sel.innerHTML = '';
        var added = 0;
        list.forEach(function (g) {
            if (g.type === 'separator' || g.group_id === undefined) return;
            var o = document.createElement('option');
            o.value = g.group_id;
            o.textContent = String(g.name).replace(/^\s*[\[\(]|[\]\)]\s*$/g, '').trim() || g.name;
            sel.appendChild(o);
            added++;
        });
        if (!added) {
            sel.innerHTML = '<option value="0">Todas</option>';
        }
    }

    function fallbackGroups() {
        // Plano B: ler os grupos da página de grupos
        $.get(game_data.link_base_pure + 'overview_villages&mode=groups&type=static', function (html) {
            var doc = $('<div>').append($.parseHTML(html));
            var list = [], seen = {};
            doc.find('[data-group-id], a[href*="group="]').each(function () {
                var el = $(this);
                var id = el.attr('data-group-id') || (String(el.attr('href')).match(/group=(\d+)/) || [])[1];
                var name = $.trim(el.text());
                if (id && name && !seen[id]) { seen[id] = 1; list.push({ group_id: id, name: name }); }
            });
            if (!list.length) {
                $('.group-menu-item, [data-group-id]').each(function () {
                    var el = $(this);
                    var id = el.attr('data-group-id');
                    var name = $.trim(el.text());
                    if (id && name && !seen[id]) { seen[id] = 1; list.push({ group_id: id, name: name }); }
                });
            }
            fillGroups(list);
        }).fail(function () { fillGroups([]); });
    }

    $.get(game_data.link_base_pure + 'groups&mode=overview&ajax=load_group_menu', function (data) {
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { data = null; }
        }
        var list = (data && data.result) ? data.result : [];
        if (list.length) { fillGroups(list); } else { fallbackGroups(); }
    }).fail(fallbackGroups);

    // ---------- Utilitários ----------
    function shuffle(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }

    function parseCoords(text) {
        var re = /(\d{1,3})\|(\d{1,3})/g, m, out = [], seen = {};
        while ((m = re.exec(text)) !== null) {
            var key = m[1] + '|' + m[2];
            if (!seen[key]) { seen[key] = 1; out.push({ x: m[1], y: m[2] }); }
        }
        return out;
    }

    // Lê as tropas que estão na aldeia (visão geral de tropas)
    function fetchVillages(groupId, cb) {
        var url = game_data.link_base_pure + 'overview_villages&mode=units&type=own_home&group=' + groupId + '&page=-1';
        $.get(url, function (html) {
            var doc = $('<div>').append($.parseHTML(html));
            var units = game_data.units.filter(function (u) { return u !== 'militia'; });
            var villages = [];
            var table = doc.find('#units_table');
            table.find('tbody tr').each(function () {
                var row = $(this);
                var link = row.find('a[href*="village="]').first();
                if (!link.length) return;
                var vid = (link.attr('href').match(/village=(\d+)/) || [])[1];
                var txt = row.find('.quickedit-label').first().text() || row.text();
                var c = txt.match(/\((\d+)\|(\d+)\)/);
                if (!vid) return;
                var cells = row.find('td.unit-item');
                var troops = {}, total = 0;
                cells.each(function (i) {
                    var n = parseInt($(this).text().replace(/\D/g, ''), 10) || 0;
                    if (units[i] && n > 0) { troops[units[i]] = n; total += n; }
                });
                if (total > 0) {
                    villages.push({ id: vid, x: c ? c[1] : '', y: c ? c[2] : '', troops: troops });
                }
            });
            cb(villages);
        }).fail(function () { cb(null); });
    }

    function buildUrl(item) {
        var base = '/game.php?village=' + item.village.id + '&screen=place&x=' + item.target.x + '&y=' + item.target.y;
        var extra = '&from=simulator';
        Object.keys(item.village.troops).forEach(function (u) {
            extra += '&att_' + u + '=' + item.village.troops[u];
        });
        return base + extra;
    }

    // ---------- Calcular ----------
    $id('aa-calc').onclick = function () {
        var targets = parseCoords($id('aa-coords').value);
        if (!targets.length) { $id('aa-info').textContent = 'Mete coordenadas alvo.'; return; }
        $id('aa-info').textContent = 'A carregar aldeias e tropas...';

        fetchVillages($id('aa-group').value, function (villages) {
            if (villages === null) { $id('aa-info').textContent = 'Erro ao carregar as aldeias.'; return; }
            if (!villages.length) { $id('aa-info').textContent = 'Nenhuma aldeia do grupo com tropas em casa.'; return; }

            shuffle(villages);
            shuffle(targets);

            // 1 ataque por aldeia. Alvos distribuídos aleatoriamente
            // (se houver mais aldeias do que alvos, repetem-se).
            var plan = [];
            for (var i = 0; i < villages.length; i++) {
                plan.push({ village: villages[i], target: targets[i % targets.length] });
            }
            state.plan = plan;
            state.opened = 0;
            renderPlan();
        });
    };

    function renderPlan() {
        var per = Math.max(1, parseInt($id('aa-per').value, 10) || 5);
        var plan = state.plan;
        $id('aa-info').textContent = plan.length + ' ataques prontos (1 por aldeia, todas as tropas).';

        var btns = $id('aa-buttons');
        btns.innerHTML = '';
        for (var s = 0; s < plan.length; s += per) {
            (function (start) {
                var end = Math.min(start + per, plan.length);
                var b = document.createElement('button');
                b.className = 'btn';
                b.style.margin = '2px';
                b.textContent = 'Abrir ' + (start + 1) + '-' + end;
                b.onclick = function () {
                    var delay = Math.max(0, parseInt($id('aa-delay').value, 10) || 0);
                    var blocked = false;
                    for (var k = start; k < end; k++) {
                        (function (idx, n) {
                            setTimeout(function () {
                                var w = window.open(buildUrl(plan[idx]), '_blank');
                                if (!w && !blocked) {
                                    blocked = true;
                                    $id('aa-info').innerHTML = '<b style="color:#a00">O Chrome bloqueou os pop-ups.</b> ' +
                                        'Clica no ícone de pop-up bloqueado na barra de endereço, escolhe "Permitir sempre pop-ups" ' +
                                        'para este site e carrega outra vez no botão. Ou abre cada ataque pelos links "abrir" da lista.';
                                }
                            }, n * delay);
                        })(k, k - start);
                    }
                    b.disabled = true;
                    b.style.opacity = '0.5';
                };
                btns.appendChild(b);
            })(s);
        }

        var html = '<table class="vis" style="width:100%"><tr><th>#</th><th>Origem</th><th>Destino</th><th>Tropas</th><th></th></tr>';
        plan.forEach(function (p, i) {
            var tr = Object.keys(p.village.troops).map(function (u) { return u + ':' + p.village.troops[u]; }).join(' ');
            html += '<tr><td>' + (i + 1) + '</td><td>' + p.village.x + '|' + p.village.y +
                '</td><td>' + p.target.x + '|' + p.target.y + '</td><td style="font-size:10px">' + tr +
                '</td><td><a href="' + buildUrl(p) + '" target="_blank">abrir</a></td></tr>';
        });
        html += '</table>';
        $id('aa-list').innerHTML = html;
    }
})();
