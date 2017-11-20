const {it, fit, ffit, fffit, beforeEach, afterEach} = require('./async-spec-helpers')
const _ = require('underscore-plus')
const path = require('path')
const temp = require('temp').track()
const AtomEnvironment = require('../src/atom-environment')
const StorageFolder = require('../src/storage-folder')

describe('AtomEnvironment', () => {
  afterEach(() => {
    try {
      temp.cleanupSync()
    } catch (error) {}
  })

  describe('window sizing methods', () => {
    describe('::getPosition and ::setPosition', () => {
      let originalPosition = null
      beforeEach(() => originalPosition = atom.getPosition())

      afterEach(() => atom.setPosition(originalPosition.x, originalPosition.y))

      it('sets the position of the window, and can retrieve the position just set', () => {
        atom.setPosition(22, 45)
        expect(atom.getPosition()).toEqual({x: 22, y: 45})
      })
    })

    describe('::getSize and ::setSize', () => {
      let originalSize = null
      beforeEach(() => originalSize = atom.getSize())
      afterEach(() => atom.setSize(originalSize.width, originalSize.height))

      it('sets the size of the window, and can retrieve the size just set', async () => {
        const newWidth = originalSize.width - 12
        const newHeight = originalSize.height - 23
        await atom.setSize(newWidth, newHeight)
        expect(atom.getSize()).toEqual({width: newWidth, height: newHeight})
      })
    })
  })

  describe('.isReleasedVersion()', () => {
    it('returns false if the version is a SHA and true otherwise', () => {
      let version = '0.1.0'
      spyOn(atom, 'getVersion').andCallFake(() => version)
      expect(atom.isReleasedVersion()).toBe(true)
      version = '36b5518'
      expect(atom.isReleasedVersion()).toBe(false)
    })
  })

  describe('loading default config', () => {
    it('loads the default core config schema', () => {
      expect(atom.config.get('core.excludeVcsIgnoredPaths')).toBe(true)
      expect(atom.config.get('core.followSymlinks')).toBe(true)
      expect(atom.config.get('editor.showInvisibles')).toBe(false)
    })
  })

  describe('window onerror handler', () => {
    let devToolsPromise = null
    beforeEach(() => {
      devToolsPromise = Promise.resolve()
      spyOn(atom, 'openDevTools').andReturn(devToolsPromise)
      spyOn(atom, 'executeJavaScriptInDevTools')
    })

    it('will open the dev tools when an error is triggered', async () => {
      try {
        a + 1
      } catch (e) {
        window.onerror.call(window, e.toString(), 'abc', 2, 3, e)
      }

      await devToolsPromise
      expect(atom.openDevTools).toHaveBeenCalled()
      expect(atom.executeJavaScriptInDevTools).toHaveBeenCalled()
    })

    describe('::onWillThrowError', () => {
      let willThrowSpy = null

      beforeEach(() => {
        willThrowSpy = jasmine.createSpy()
      })

      it('is called when there is an error', () => {
        let error = null
        atom.onWillThrowError(willThrowSpy)
        try {
          a + 1
        } catch (e) {
          error = e
          window.onerror.call(window, e.toString(), 'abc', 2, 3, e)
        }

        delete willThrowSpy.mostRecentCall.args[0].preventDefault
        expect(willThrowSpy).toHaveBeenCalledWith({
          message: error.toString(),
          url: 'abc',
          line: 2,
          column: 3,
          originalError: error
        })
      })

      it('will not show the devtools when preventDefault() is called', () => {
        willThrowSpy.andCallFake(errorObject => errorObject.preventDefault())
        atom.onWillThrowError(willThrowSpy)

        try {
          a + 1
        } catch (e) {
          window.onerror.call(window, e.toString(), 'abc', 2, 3, e)
        }

        expect(willThrowSpy).toHaveBeenCalled()
        expect(atom.openDevTools).not.toHaveBeenCalled()
        expect(atom.executeJavaScriptInDevTools).not.toHaveBeenCalled()
      })
    })

    describe('::onDidThrowError', () => {
      let didThrowSpy = null
      beforeEach(() => didThrowSpy = jasmine.createSpy())

      it('is called when there is an error', () => {
        let error = null
        atom.onDidThrowError(didThrowSpy)
        try {
          a + 1
        } catch (e) {
          error = e
          window.onerror.call(window, e.toString(), 'abc', 2, 3, e)
        }
        expect(didThrowSpy).toHaveBeenCalledWith({
          message: error.toString(),
          url: 'abc',
          line: 2,
          column: 3,
          originalError: error
        })
      })
    })
  })

  describe('.assert(condition, message, callback)', () => {
    let errors = null

    beforeEach(() => {
      errors = []
      spyOn(atom, 'isReleasedVersion').andReturn(true)
      atom.onDidFailAssertion(error => errors.push(error))
    })

    describe('if the condition is false', () => {
      it('notifies onDidFailAssertion handlers with an error object based on the call site of the assertion', () => {
        const result = atom.assert(false, 'a == b')
        expect(result).toBe(false)
        expect(errors.length).toBe(1)
        expect(errors[0].message).toBe('Assertion failed: a == b')
        expect(errors[0].stack).toContain('atom-environment-spec')
      })

      describe('if passed a callback function', () => {
        it("calls the callback with the assertion failure's error object", () => {
          let error = null
          atom.assert(false, 'a == b', e => error = e)
          expect(error).toBe(errors[0])
        })
      })

      describe('if passed metadata', () => {
        it("assigns the metadata on the assertion failure's error object", () => {
          atom.assert(false, 'a == b', {foo: 'bar'})
          expect(errors[0].metadata).toEqual({foo: 'bar'})
        })
      })

      describe('when Atom has been built from source', () => {
        it('throws an error', () => {
          atom.isReleasedVersion.andReturn(false)
          expect(() => atom.assert(false, 'testing')).toThrow('Assertion failed: testing')
        })
      })
    })

    describe('if the condition is true', () => {
      it('does nothing', () => {
        const result = atom.assert(true, 'a == b')
        expect(result).toBe(true)
        expect(errors).toEqual([])
      })
    })
  })

  describe('saving and loading', () => {
    beforeEach(() => atom.enablePersistence = true)

    afterEach(() => atom.enablePersistence = false)

    it('selects the state based on the current project paths', async () => {
      jasmine.useRealClock()

      const [dir1, dir2] = [temp.mkdirSync('dir1-'), temp.mkdirSync('dir2-')]

      const loadSettings = Object.assign(atom.getLoadSettings(), {
        initialPaths: [dir1],
        windowState: null
      })

      spyOn(atom, 'getLoadSettings').andCallFake(() => loadSettings)
      spyOn(atom, 'serialize').andReturn({stuff: 'cool'})

      atom.project.setPaths([dir1, dir2])

      // State persistence will fail if other Atom instances are running
      expect(await atom.stateStore.connect()).toBe(true)

      await atom.saveState()
      expect(await atom.loadState()).toBeFalsy()

      loadSettings.initialPaths = [dir2, dir1]
      expect(await atom.loadState()).toEqual({stuff: 'cool'})
    })

    it('saves state when the CPU is idle after a keydown or mousedown event', () => {
      const atomEnv = new AtomEnvironment({
        applicationDelegate: global.atom.applicationDelegate
      })
      const idleCallbacks = []
      atomEnv.initialize({
        window: {
          requestIdleCallback (callback) { idleCallbacks.push(callback) },
          addEventListener () {},
          removeEventListener () {}
        },
        document: document.implementation.createHTMLDocument()
      })

      spyOn(atomEnv, 'saveState')

      const keydown = new KeyboardEvent('keydown')
      atomEnv.document.dispatchEvent(keydown)
      advanceClock(atomEnv.saveStateDebounceInterval)
      idleCallbacks.shift()()
      expect(atomEnv.saveState).toHaveBeenCalledWith({isUnloading: false})
      expect(atomEnv.saveState).not.toHaveBeenCalledWith({isUnloading: true})

      atomEnv.saveState.reset()
      const mousedown = new MouseEvent('mousedown')
      atomEnv.document.dispatchEvent(mousedown)
      advanceClock(atomEnv.saveStateDebounceInterval)
      idleCallbacks.shift()()
      expect(atomEnv.saveState).toHaveBeenCalledWith({isUnloading: false})
      expect(atomEnv.saveState).not.toHaveBeenCalledWith({isUnloading: true})

      atomEnv.destroy()
    })

    it('ignores mousedown/keydown events happening after calling unloadEditorWindow', () => {
      const atomEnv = new AtomEnvironment({
        applicationDelegate: global.atom.applicationDelegate
      })
      const idleCallbacks = []
      atomEnv.initialize({
        window: {
          requestIdleCallback (callback) { idleCallbacks.push(callback) },
          addEventListener () {},
          removeEventListener () {}
        },
        document: document.implementation.createHTMLDocument()
      })

      spyOn(atomEnv, 'saveState')

      let mousedown = new MouseEvent('mousedown')
      atomEnv.document.dispatchEvent(mousedown)
      atomEnv.unloadEditorWindow()
      expect(atomEnv.saveState).not.toHaveBeenCalled()

      advanceClock(atomEnv.saveStateDebounceInterval)
      idleCallbacks.shift()()
      expect(atomEnv.saveState).not.toHaveBeenCalled()

      mousedown = new MouseEvent('mousedown')
      atomEnv.document.dispatchEvent(mousedown)
      advanceClock(atomEnv.saveStateDebounceInterval)
      idleCallbacks.shift()()
      expect(atomEnv.saveState).not.toHaveBeenCalled()

      atomEnv.destroy()
    })

    it('serializes the project state with all the options supplied in saveState', async () => {
      spyOn(atom.project, 'serialize').andReturn({foo: 42})

      await atom.saveState({anyOption: 'any option'})
      expect(atom.project.serialize.calls.length).toBe(1)
      expect(atom.project.serialize.mostRecentCall.args[0]).toEqual({anyOption: 'any option'})
    })

    it('serializes the text editor registry', async () => {
      await atom.packages.activatePackage('language-text')
      const editor = await atom.workspace.open('sample.js')
      expect(atom.grammars.assignLanguageMode(editor, 'plain text')).toBe(true)

      const atom2 = new AtomEnvironment({
        applicationDelegate: atom.applicationDelegate,
        window: document.createElement('div'),
        document: Object.assign(
          document.createElement('div'),
          {
            body: document.createElement('div'),
            head: document.createElement('div')
          }
        )
      })
      atom2.initialize({document, window})

      await atom2.deserialize(atom.serialize())
      await atom2.packages.activatePackage('language-text')
      const editor2 = atom2.workspace.getActiveTextEditor()
      expect(editor2.getBuffer().getLanguageMode().getLanguageName()).toBe('Plain Text')
      atom2.destroy()
    })

    describe('deserialization failures', () => {
      it('propagates project state restoration failures', async () => {
        spyOn(atom.project, 'deserialize').andCallFake(() => {
          const err = new Error('deserialization failure')
          err.missingProjectPaths = ['/foo']
          return Promise.reject(err)
        })
        spyOn(atom.notifications, 'addError')

        await atom.deserialize({project: 'should work'})
        expect(atom.notifications.addError).toHaveBeenCalledWith('Unable to open project directory', {
          description: 'Project directory `/foo` is no longer on disk.'
        })
      })

      it('accumulates and reports two errors with one notification', async () => {
        spyOn(atom.project, 'deserialize').andCallFake(() => {
          const err = new Error('deserialization failure')
          err.missingProjectPaths = ['/foo', '/wat']
          return Promise.reject(err)
        })
        spyOn(atom.notifications, 'addError')

        await atom.deserialize({project: 'should work'})
        expect(atom.notifications.addError).toHaveBeenCalledWith('Unable to open 2 project directories', {
          description: 'Project directories `/foo` and `/wat` are no longer on disk.'
        })
      })

      it('accumulates and reports three+ errors with one notification', async () => {
        spyOn(atom.project, 'deserialize').andCallFake(() => {
          const err = new Error('deserialization failure')
          err.missingProjectPaths = ['/foo', '/wat', '/stuff', '/things']
          return Promise.reject(err)
        })
        spyOn(atom.notifications, 'addError')

        await atom.deserialize({project: 'should work'})
        expect(atom.notifications.addError).toHaveBeenCalledWith('Unable to open 4 project directories', {
          description: 'Project directories `/foo`, `/wat`, `/stuff`, and `/things` are no longer on disk.'
        })
      })
    })
  })

  describe('openInitialEmptyEditorIfNecessary', () => {
    describe('when there are no paths set', () => {
      beforeEach(() => spyOn(atom, 'getLoadSettings').andReturn({initialPaths: []}))

      it('opens an empty buffer', () => {
        spyOn(atom.workspace, 'open')
        atom.openInitialEmptyEditorIfNecessary()
        expect(atom.workspace.open).toHaveBeenCalledWith(null)
      })

      describe('when there is already a buffer open', () => {
        beforeEach(async () => {
          await atom.workspace.open()
        })

        it('does not open an empty buffer', () => {
          spyOn(atom.workspace, 'open')
          atom.openInitialEmptyEditorIfNecessary()
          expect(atom.workspace.open).not.toHaveBeenCalled()
        })
      })
    })

    describe('when the project has a path', () => {
      beforeEach(() => {
        spyOn(atom, 'getLoadSettings').andReturn({initialPaths: ['something']})
        spyOn(atom.workspace, 'open')
      })

      it('does not open an empty buffer', () => {
        atom.openInitialEmptyEditorIfNecessary()
        expect(atom.workspace.open).not.toHaveBeenCalled()
      })
    })
  })

  describe('adding a project folder', () => {
    it('does nothing if the user dismisses the file picker', () => {
      const initialPaths = atom.project.getPaths()
      const tempDirectory = temp.mkdirSync('a-new-directory')
      spyOn(atom, 'pickFolder').andCallFake(callback => callback(null))
      atom.addProjectFolder()
      expect(atom.project.getPaths()).toEqual(initialPaths)
    })

    describe('when there is no saved state for the added folders', () => {
      beforeEach(() => {
        spyOn(atom, 'loadState').andReturn(Promise.resolve(null))
        spyOn(atom, 'attemptRestoreProjectStateForPaths')
      })

      it('adds the selected folder to the project', async () => {
        const initialPaths = atom.project.setPaths([])
        const tempDirectory = temp.mkdirSync('a-new-directory')
        spyOn(atom, 'pickFolder').andCallFake(callback => callback([tempDirectory]))
        await atom.addProjectFolder()
        expect(atom.project.getPaths()).toEqual([tempDirectory])
        expect(atom.attemptRestoreProjectStateForPaths).not.toHaveBeenCalled()
      })
    })

    describe('when there is saved state for the relevant directories', () => {
      const state = Symbol('savedState')

      beforeEach(() => {
        spyOn(atom, 'getStateKey').andCallFake(dirs => dirs.join(':'))
        spyOn(atom, 'loadState').andCallFake(async (key) => key === __dirname ? state : null)
        spyOn(atom, 'attemptRestoreProjectStateForPaths')
        spyOn(atom, 'pickFolder').andCallFake(callback => callback([__dirname]))
        atom.project.setPaths([])
      })

      describe('when there are no project folders', () => {
        it('attempts to restore the project state', async () => {
          await atom.addProjectFolder()
          expect(atom.attemptRestoreProjectStateForPaths).toHaveBeenCalledWith(state, [__dirname])
          expect(atom.project.getPaths()).toEqual([])
        })
      })

      describe('when there are already project folders', () => {
        const openedPath = path.join(__dirname, 'fixtures')

        beforeEach(() => atom.project.setPaths([openedPath]))

        it('does not attempt to restore the project state, instead adding the project paths', async () => {
          await atom.addProjectFolder()
          expect(atom.attemptRestoreProjectStateForPaths).not.toHaveBeenCalled()
          expect(atom.project.getPaths()).toEqual([openedPath, __dirname])
        })
      })
    })
  })

  describe('attemptRestoreProjectStateForPaths(state, projectPaths, filesToOpen)', () => {
    describe('when the window is clean (empty or has only unnamed, unmodified buffers)', () => {
      beforeEach(async () => {
        // Unnamed, unmodified buffer doesn't count toward "clean"-ness
        await atom.workspace.open()
      })

      it('automatically restores the saved state into the current environment', () => {
        const state = {}
        spyOn(atom.workspace, 'open')
        spyOn(atom, 'restoreStateIntoThisEnvironment')

        atom.attemptRestoreProjectStateForPaths(state, [__dirname], [__filename])
        expect(atom.restoreStateIntoThisEnvironment).toHaveBeenCalledWith(state)
        expect(atom.workspace.open.callCount).toBe(1)
        expect(atom.workspace.open).toHaveBeenCalledWith(__filename)
      })

      describe('when a dock has a non-text editor', () => {
        it("doesn't prompt the user to restore state", () => {
          const dock = atom.workspace.getLeftDock()
          dock.getActivePane().addItem({
            getTitle () { return 'title' },
            element: document.createElement('div')
          })
          const state = {}
          spyOn(atom, 'confirm')
          atom.attemptRestoreProjectStateForPaths(state, [__dirname], [__filename])
          expect(atom.confirm).not.toHaveBeenCalled()
        })
      })
    })

    describe('when the window is dirty', () => {
      let editor

      beforeEach(async () => {
        editor = await atom.workspace.open()
        editor.setText('new editor')
      })

      describe('when a dock has a modified editor', () => {
        it('prompts the user to restore the state', () => {
          const dock = atom.workspace.getLeftDock()
          dock.getActivePane().addItem(editor)
          spyOn(atom, 'confirm').andReturn(1)
          spyOn(atom.project, 'addPath')
          spyOn(atom.workspace, 'open')
          const state = Symbol()
          atom.attemptRestoreProjectStateForPaths(state, [__dirname], [__filename])
          expect(atom.confirm).toHaveBeenCalled()
        })
      })

      it('prompts the user to restore the state in a new window, discarding it and adding folder to current window', () => {
        spyOn(atom, 'confirm').andReturn(1)
        spyOn(atom.project, 'addPath')
        spyOn(atom.workspace, 'open')
        const state = Symbol()

        atom.attemptRestoreProjectStateForPaths(state, [__dirname], [__filename])
        expect(atom.confirm).toHaveBeenCalled()
        expect(atom.project.addPath.callCount).toBe(1)
        expect(atom.project.addPath).toHaveBeenCalledWith(__dirname)
        expect(atom.workspace.open.callCount).toBe(1)
        expect(atom.workspace.open).toHaveBeenCalledWith(__filename)
      })

      it('prompts the user to restore the state in a new window, opening a new window', () => {
        spyOn(atom, 'confirm').andReturn(0)
        spyOn(atom, 'open')
        const state = Symbol()

        atom.attemptRestoreProjectStateForPaths(state, [__dirname], [__filename])
        expect(atom.confirm).toHaveBeenCalled()
        expect(atom.open).toHaveBeenCalledWith({
          pathsToOpen: [__dirname, __filename],
          newWindow: true,
          devMode: atom.inDevMode(),
          safeMode: atom.inSafeMode()
        })
      })
    })
  })

  describe('::unloadEditorWindow()', () => {
    it('saves the BlobStore so it can be loaded after reload', () => {
      const configDirPath = temp.mkdirSync('atom-spec-environment')
      const fakeBlobStore = jasmine.createSpyObj('blob store', ['save'])
      const atomEnvironment = new AtomEnvironment({applicationDelegate: atom.applicationDelegate, enablePersistence: true})
      atomEnvironment.initialize({configDirPath, blobStore: fakeBlobStore, window, document})

      atomEnvironment.unloadEditorWindow()

      expect(fakeBlobStore.save).toHaveBeenCalled()

      atomEnvironment.destroy()
    })
  })

  describe('::destroy()', () => {
    it('does not throw exceptions when unsubscribing from ipc events (regression)', async () => {
      const configDirPath = temp.mkdirSync('atom-spec-environment')
      const fakeDocument = {
        addEventListener () {},
        removeEventListener () {},
        head: document.createElement('head'),
        body: document.createElement('body')
      }
      const atomEnvironment = new AtomEnvironment({applicationDelegate: atom.applicationDelegate})
      atomEnvironment.initialize({window, document: fakeDocument})
      spyOn(atomEnvironment.packages, 'loadPackages').andReturn(Promise.resolve())
      spyOn(atomEnvironment.packages, 'activate').andReturn(Promise.resolve())
      spyOn(atomEnvironment, 'displayWindow').andReturn(Promise.resolve())
      await atomEnvironment.startEditorWindow()
      atomEnvironment.unloadEditorWindow()
      atomEnvironment.destroy()
    })
  })

  describe('::whenShellEnvironmentLoaded()', () => {
    let atomEnvironment, envLoaded, spy

    beforeEach(() => {
      let resolve = null
      const promise = new Promise((r) => { resolve = r })
      envLoaded = () => {
        resolve()
        promise
      }
      atomEnvironment = new AtomEnvironment({
        applicationDelegate: atom.applicationDelegate,
        updateProcessEnv () { return promise }
      })
      atomEnvironment.initialize({window, document})
      spy = jasmine.createSpy()
    })

    afterEach(() => atomEnvironment.destroy())

    it('is triggered once the shell environment is loaded', async () => {
      atomEnvironment.whenShellEnvironmentLoaded(spy)
      atomEnvironment.updateProcessEnvAndTriggerHooks()
      await envLoaded()
      expect(spy).toHaveBeenCalled()
    })

    it('triggers the callback immediately if the shell environment is already loaded', async () => {
      atomEnvironment.updateProcessEnvAndTriggerHooks()
      await envLoaded()
      atomEnvironment.whenShellEnvironmentLoaded(spy)
      expect(spy).toHaveBeenCalled()
    })
  })

  describe('::openLocations(locations) (called via IPC from browser process)', () => {
    beforeEach(() => {
      spyOn(atom.workspace, 'open')
      atom.project.setPaths([])
    })

    describe('when there is no saved state', () => {
      beforeEach(() => {
        spyOn(atom, 'loadState').andReturn(Promise.resolve(null))
      })

      describe('when the opened path exists', () => {
        it("adds it to the project's paths", async () => {
          const pathToOpen = __filename
          await atom.openLocations([{pathToOpen}])
          expect(atom.project.getPaths()[0]).toBe(__dirname)
        })

        describe('then a second path is opened with forceAddToWindow', () => {
          it("adds the second path to the project's paths", async () => {
            const firstPathToOpen = __dirname
            const secondPathToOpen = path.resolve(__dirname, './fixtures')
            await atom.openLocations([{pathToOpen: firstPathToOpen}])
            await atom.openLocations([{pathToOpen: secondPathToOpen, forceAddToWindow: true}])
            expect(atom.project.getPaths()).toEqual([firstPathToOpen, secondPathToOpen])
          })
        })
      })

      describe('when the opened path does not exist but its parent directory does', () => {
        it('adds the parent directory to the project paths', async () => {
          const pathToOpen = path.join(__dirname, 'this-path-does-not-exist.txt')
          await atom.openLocations([{pathToOpen}])
          expect(atom.project.getPaths()[0]).toBe(__dirname)
        })
      })

      describe('when the opened path is a file', () => {
        it('opens it in the workspace', async () => {
          const pathToOpen = __filename
          await atom.openLocations([{pathToOpen}])
          expect(atom.workspace.open.mostRecentCall.args[0]).toBe(__filename)
        })
      })

      describe('when the opened path is a directory', () => {
        it('does not open it in the workspace', async () => {
          const pathToOpen = __dirname
          await atom.openLocations([{pathToOpen}])
          expect(atom.workspace.open.callCount).toBe(0)
        })
      })

      describe('when the opened path is a uri', () => {
        it("adds it to the project's paths as is", async () => {
          const pathToOpen = 'remote://server:7644/some/dir/path'
          spyOn(atom.project, 'addPath')
          await atom.openLocations([{pathToOpen}])
          expect(atom.project.addPath).toHaveBeenCalledWith(pathToOpen)
        })
      })
    })

    describe('when there is saved state for the relevant directories', () => {
      const state = Symbol('savedState')

      beforeEach(() => {
        spyOn(atom, 'getStateKey').andCallFake(dirs => dirs.join(':'))
        spyOn(atom, 'loadState').andCallFake(function (key) {
          if (key === __dirname) { return Promise.resolve(state) } else { return Promise.resolve(null) }
        })
        spyOn(atom, 'attemptRestoreProjectStateForPaths')
      })

      describe('when there are no project folders', () => {
        it('attempts to restore the project state', async () => {
          const pathToOpen = __dirname
          await atom.openLocations([{pathToOpen}])
          expect(atom.attemptRestoreProjectStateForPaths).toHaveBeenCalledWith(state, [pathToOpen], [])
          expect(atom.project.getPaths()).toEqual([])
        })

        it('opens the specified files', async () => {
          await atom.openLocations([{pathToOpen: __dirname}, {pathToOpen: __filename}])
          expect(atom.attemptRestoreProjectStateForPaths).toHaveBeenCalledWith(state, [__dirname], [__filename])
          expect(atom.project.getPaths()).toEqual([])
        })
      })

      describe('when there are already project folders', () => {
        beforeEach(() => atom.project.setPaths([__dirname]))

        it('does not attempt to restore the project state, instead adding the project paths', async () => {
          const pathToOpen = path.join(__dirname, 'fixtures')
          await atom.openLocations([{pathToOpen, forceAddToWindow: true}])
          expect(atom.attemptRestoreProjectStateForPaths).not.toHaveBeenCalled()
          expect(atom.project.getPaths()).toEqual([__dirname, pathToOpen])
        })

        it('opens the specified files', async () => {
          const pathToOpen = path.join(__dirname, 'fixtures')
          const fileToOpen = path.join(pathToOpen, 'michelle-is-awesome.txt')
          await atom.openLocations([{pathToOpen}, {pathToOpen: fileToOpen}])
          expect(atom.attemptRestoreProjectStateForPaths).not.toHaveBeenCalledWith(state, [pathToOpen], [fileToOpen])
          expect(atom.project.getPaths()).toEqual([__dirname])
        })
      })
    })
  })

  describe('::updateAvailable(info) (called via IPC from browser process)', () => {
    let subscription

    afterEach(() => {
      if (subscription) subscription.dispose()
    })

    it('invokes onUpdateAvailable listeners', async () => {
      if (process.platform !== 'darwin') return // Test tied to electron autoUpdater, we use something else on Linux and Win32

      const updateAvailablePromise = new Promise(resolve => {
        subscription = atom.onUpdateAvailable(resolve)
      })

      atom.listenForUpdates()
      const {autoUpdater} = require('electron').remote
      autoUpdater.emit('update-downloaded', null, 'notes', 'version')

      const {releaseVersion} = await updateAvailablePromise
      expect(releaseVersion).toBe('version')
    })
  })

  describe('::getReleaseChannel()', () => {
    let version

    beforeEach(() => {
      spyOn(atom, 'getVersion').andCallFake(() => version)
    })

    it('returns the correct channel based on the version number', () => {
      version = '1.5.6'
      expect(atom.getReleaseChannel()).toBe('stable')

      version = '1.5.0-beta10'
      expect(atom.getReleaseChannel()).toBe('beta')

      version = '1.7.0-dev-5340c91'
      expect(atom.getReleaseChannel()).toBe('dev')
    })
  })
})
