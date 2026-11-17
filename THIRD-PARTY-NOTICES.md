# Third-party runtime notices

The generated extension includes runtime helpers from WXT and @wxt-dev/browser,
part of https://github.com/wxt-dev/wxt. Their license follows. The application's
own license is in LICENSE. Build-only dependencies are recorded in package-lock.json.

MIT License

Copyright (c) 2023 Aaron

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Pruned Alap tag core

Source includes a modified, dependency-free Alap derivative, revision
`waypoints-refiners-r2`, Copyright 2026 Daniel Smith, licensed under Apache-2.0.
Its source, provenance and full license are in `src/vendor/alap-tags-core/`.
This derivative retains tag matching, ordered set operators, grouping and five
reviewed local refiner operations derived from Alap RefinerPipeline.ts;
it contains no protocol/source handlers, network capabilities or plugin registry.
The private editor uses the evaluator. The extension popup uses the strict syntax
module to validate macro definitions in backups.
