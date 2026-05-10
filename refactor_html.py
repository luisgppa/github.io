#!/usr/bin/env python3
"""
refactor_html.py
Elimina el bloque <style>…</style> de cada ficha de obra,
añade <link rel="stylesheet" href="estilos.css"> (o ../estilos.css),
y añade la clase .ratio-3-4 o .ratio-4-5 al div.imagen-principal.

Archivos que NO se tocan (páginas de sección / sitio):
  - index.html, obra.html, bio.html, contacto.html, textos.html,
    ferrum.html, figuras.html, tierra.html, ecos.html, sabotaje.html,
    cartografia.html, 404.html, mor.html, libro-poemas.html,
    poemas-materiales.html, robots.txt, sitemap.xml
  - paisajes-de-guerra/ (estructura diferente, ya tienen ../estilos.css
    con su propio <style> específico — no son fichas estándar)
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.abspath(__file__))

# Páginas que NO son fichas de obra — NO SE TOCAN
EXCLUDE = {
    "index.html",
    "obra.html",
    "bio.html",
    "contacto.html",
    "textos.html",
    "ferrum.html",
    "figuras.html",
    "tierra.html",
    "ecos.html",
    "sabotaje.html",
    "cartografia.html",
    "404.html",
    "mor.html",
    "libro-poemas.html",
    "poemas-materiales.html",
}

# Fichas con aspect-ratio 3/4 (esculturas: ferrum, tierra, stanbrook…)
RATIO_3_4 = {
    "ferrum-3.html", "ferrum-4.html", "ferrum-5.html", "ferrum-6.html",
    "ferrum-7.html", "ferrum-8.html", "ferrum-9.html", "ferrum-10.html",
    "ferrum-11.html", "ferrum-12.html", "ferrum-13.html", "ferrum-14.html",
    "ferrum-15.html", "ferrum-16.html", "ferrum-17.html", "ferrum-18.html",
    "ferrum-interacciones.html", "stanbrook.html",
    "tierra-1.html", "tierra-2.html", "tierra-3.html", "tierra-4.html",
    "tierra-5.html", "tierra-6.html", "tierra-7.html", "tierra-8.html",
    "tierra-9.html", "tierra-10.html", "tierra-11.html", "tierra-12.html",
    "tierra-13.html", "tierra-14.html", "tierra-15.html", "tierra-16.html",
    "tierra-17.html", "tierra-18.html", "tierra-19.html", "tierra-20.html",
    "tierra-21.html", "tierra-22.html", "tierra-23.html", "tierra-24.html",
    "tierra-25.html", "tierra-26.html", "tierra-27.html", "tierra-28.html",
    "tierra-29.html", "tierra-31.html", "tierra-casalectura.html",
}

# Fichas con aspect-ratio 4/5 (pinturas, figuras, ecos del fuego, sabotaje,
# cartografía del movimiento)
RATIO_4_5 = {
    "figura-uno.html", "figura-dos.html", "figura-tres.html",
    "figura-cuatro.html", "figura-cinco.html", "figura-seis.html",
    "figura-siete.html", "figura-ocho.html", "figura-nueve.html",
    "figura-diez.html",
    "amanecer.html", "ausencia.html", "brotes.html", "fuego.html",
    "impulso.html", "inercia.html", "desplazamiento.html",
    "sabotaje-caos.html", "sabotaje-virus.html",
}

# Patrón para encontrar el bloque <style>…</style> completo en el <head>
RE_STYLE_BLOCK = re.compile(
    r'\n?[ \t]*<style>.*?</style>[ \t]*\n?',
    re.DOTALL | re.IGNORECASE
)

# Patrón para encontrar el <link> de estilos.css (por si ya existe)
RE_LINK_ESTILOS = re.compile(
    r'<link\s[^>]*href=["\'](?:\.\./)?estilos\.css["\'][^>]*>',
    re.IGNORECASE
)

# Patrón para localizar el div.imagen-principal (con o sin clases/atributos)
# Captura: <div + espacio/salto + class="imagen-principal" + resto de atributos + >
# Nota: cubre también casos con atributos antes de class.
RE_IMG_PRINCIPAL_DIV = re.compile(
    r'(<div\b[^>]*\bclass=")(imagen-principal)(")',
    re.IGNORECASE
)


def process_file(filepath, filename, is_subdir=False):
    with open(filepath, 'r', encoding='utf-8') as f:
        html = f.read()

    original = html
    changed = []

    # 1. Eliminar bloque(s) <style>…</style>
    if RE_STYLE_BLOCK.search(html):
        html = RE_STYLE_BLOCK.sub('\n', html)
        # Limpiar líneas en blanco múltiples que puedan quedar
        html = re.sub(r'\n{3,}', '\n\n', html)
        changed.append("style-block eliminado")

    # 2. Añadir <link rel="stylesheet" href="estilos.css"> si no existe
    href = "../estilos.css" if is_subdir else "estilos.css"
    link_tag = f'<link rel="stylesheet" href="{href}">'

    if not RE_LINK_ESTILOS.search(html):
        # Insertar justo antes del cierre </head> o antes de </style> — o
        # después del último <link> de fonts de Google
        insert_after = re.compile(
            r'(</head>)',
            re.IGNORECASE
        )
        # Preferimos insertarlo antes del cierre </head>
        if insert_after.search(html):
            html = insert_after.sub(f'  {link_tag}\n</head>', html, count=1)
            changed.append("link añadido")
        else:
            print(f"  ADVERTENCIA: no se encontró </head> en {filename}")
    else:
        # Ya existe el link; asegurarse de que apunta a la ruta correcta
        existing = RE_LINK_ESTILOS.search(html)
        if existing and existing.group(0) != link_tag:
            html = RE_LINK_ESTILOS.sub(link_tag, html, count=1)
            changed.append("link corregido")
        else:
            changed.append("link ya existía")

    # 3. Añadir clase de ratio al div.imagen-principal
    ratio_class = None
    if filename in RATIO_3_4:
        ratio_class = "ratio-3-4"
    elif filename in RATIO_4_5:
        ratio_class = "ratio-4-5"

    if ratio_class:
        def add_ratio_class(m):
            before, cls, after = m.group(1), m.group(2), m.group(3)
            # Si ya tiene la clase, no duplicar
            if ratio_class in cls or ratio_class in before:
                return m.group(0)
            return f'{before}{cls} {ratio_class}{after}'
        new_html, n = RE_IMG_PRINCIPAL_DIV.subn(add_ratio_class, html)
        if n > 0:
            html = new_html
            changed.append(f"clase {ratio_class} añadida")
        else:
            # Puede ser un <a class="imagen-principal"…> en vez de div
            re_a = re.compile(
                r'(<(?:a|div)\b[^>]*\bclass=")(imagen-principal)(")',
                re.IGNORECASE
            )
            new_html, n = re_a.subn(add_ratio_class, html)
            if n > 0:
                html = new_html
                changed.append(f"clase {ratio_class} añadida (a/div)")
            else:
                changed.append(f"AVISO: div.imagen-principal no encontrado — {ratio_class} no añadido")

    if html != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"  OK  {filename:40s} | {', '.join(changed)}")
    else:
        print(f"  -- sin cambios: {filename}")


def main():
    processed = 0
    skipped = 0

    print("=== Procesando fichas de obra en la raíz ===")
    root_htmls = sorted([
        f for f in os.listdir(REPO)
        if f.endswith('.html')
    ])
    for fname in root_htmls:
        if fname in EXCLUDE:
            skipped += 1
            continue
        fpath = os.path.join(REPO, fname)
        if os.path.isfile(fpath):
            process_file(fpath, fname, is_subdir=False)
            processed += 1

    # paisajes-de-guerra: solo minab.html es una ficha de obra, pero tiene
    # layout y CSS propios completamente distintos (galería, tríptico bilingüe).
    # NO se toca ningún archivo de ese subdirectorio.
    print("\n=== paisajes-de-guerra/ — OMITIDO (layout especial) ===")

    print(f"\nTotal procesados: {processed} | omitidos: {skipped}")


if __name__ == "__main__":
    main()
