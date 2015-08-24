// TODO:
// - Reduce firebase footprint when mouse events are disabled in options.

// Declare some globals
var g_localUser, g_worldOffset, g_worldScale, g_objectLoader, g_camera, g_renderer, g_scene, g_clock, g_rayCaster, g_enclosure, g_deltaTime, g_crosshair, g_lookHit, g_numSyncedInstances, g_networkReady, g_floorPlane;

// Extend the window object.
window.JumpStart = new jumpStart();

// Listen for ready events
if( !JumpStart.webMode )
{
	window.addEventListener("AltContentLoaded", function()
	{
		altspace.getEnclosure().then(function(enclosure)
		{
			JumpStart.enclosure = enclosure;

			altspace.getUser().then(function(user)
			{
				JumpStart.localUser = user;
				JumpStart.connectToFirebase();
			});
		});
	});
}
else
{
	window.addEventListener( 'DOMContentLoaded', function()
	{
//		setTimeout(function() {
			JumpStart.connectToFirebase();
//		}, 1000);
	});

	window.addEventListener( 'resize', function() { JumpStart.onWindowResize(); }, false );
	window.addEventListener( 'mousemove', function(e) { JumpStart.onMouseMove(e); }, false);
	window.addEventListener( 'mousedown', function(e) { JumpStart.onMouseDown(e); }, false);
	window.addEventListener( 'mouseup', function(e) { JumpStart.onMouseUp(e); }, false);
	document.body.style.backgroundColor = "rgba(0, 0, 0, 1.0)";
}

function jumpStart()
{
	// Certain values are read-only after JumpStart has been initialized
	this.initialized = false;
	this.altContentAlreadyLoaded = false;
	this.modelLoader = new jumpStartModelLoader();
	this.objectLoader = null;
	this.camera = null
	this.renderer = null;
	this.clock = null;
	this.rayCaster = null;
	this.cursorRay = null;
	this.futureCursorRay = null;
	this.enclosure = null;
	this.localUser = null;
	this.scene = null;
	this.clickedObject = null;
	this.hoveredObject = null;
	this.deltaTime = 0.0;
	this.crosshair = null;
	this.firebaseSync = null;
	this.syncedInstances = {};

	// Any properties of a scene object's JumpStart sub-object that are NOT whitelisted get auto-synced.
	this.noSyncProperties = ["addDataListener", "setTint", "makePhysics", "makeStatic", "applyForce", "sync", "hasCursorEffects", "blocksLOS", "onCursorLeave", "onCursorUp", "onCursorDown", "onTick", "onSpawn", "onNetworkRemoved", "tintColor", "velocity", "key"];

	this.networkReady = false;	// Know if we are networked & ready to go.
	this.localDataListeners = {};	// Need to simulate network activity locally
	this.pendingObjects = {};
	this.numSyncedInstances = 0;
	this.initialSync = true;
	this.debugui = new jumpStartDebugUI();
	this.pendingDataListeners = [];
	this.floorPlane = {};

	this.cachedSounds = {};

	// FIXME: placeholders for real input event handlers.  will be something basic, like unity itself uses.
	this.pendingClick = false;
	this.pendingClickUp = false;
	this.pendingEventA = null;

	this.models = [];

	this.options =
	{
		"debugMode": false,
		"legacyLoader": false,
		"worldScale": 1.0,
		"scaleWithEnclosure": false,
		"enabledCursorEvents":
		{
			"cursorDown": true,
			"cursorUp": true,
			"cursorEnter": true,
			"cursorLeave": true,
			"cursorMove": true,
			"bottomPlane": true,
			"topPlane": true,
			"northPlane": true,
			"southPlane": true,
			"eastPlane": true,
			"westPlane": true
		},
		"camera":
		{
			"lookAtOrigin": true,
			"position": new THREE.Vector3(-5.0, 10.0, 30.0),
			"translation": new THREE.Vector3(40.0, 30.0, 180.0)
		},
		"firebase":
		{
			"rootUrl": "",
			"appId": "",
			"params": { "AUTOSYNC": true, "TRACE": false }
		}
	};

	this.worldScale;
	this.worldOffset = new THREE.Vector3();
	this.webMode = !window.hasOwnProperty("altspace");
}

jumpStart.prototype.connectToFirebase = function()
{
	if( this.options.firebase.rootURL === "" || this.options.firebase.appId === "" )
	{
		this.initiate();
	}
	else
	{
		this.firebaseSync = new FirebaseSync(this.options.firebase.rootUrl, this.options.firebase.appId, this.options.firebase.params);
		this.firebaseSync.connect(JumpStart.onFirebaseConnect(), function(key, syncData) { JumpStart.onFirebaseAddObject(key, syncData); }, function(key, syncData) { JumpStart.onFirebaseRemoveObject(key, syncData); });
	}
};

jumpStart.prototype.onFirebaseConnect = function()
{
	console.log("Connected to firebase.");

	// TODO make sure that here (after the connect call) isn't too late to set this flag!!
	this.networkReady = true;
	g_networkReady = this.networkReady;

	// Finish initiating the game world...
	// Might want to wait to make sure all items get sycned
//	setTimeout(function(){
		JumpStart.initiate();
//	}, 1000);
};

jumpStart.prototype.onFirebaseAddObject = function(key, syncData)
{
	if( this.syncedInstances.hasOwnProperty(key) )
		return;	// We already exist. (THIS SHOULD NEVER HAPPEN?? Probably not needed.)

	// Make sure we are ready to spawn stuff.
//	if( !this.initialSync )
//		this.networkSpawn(key, syncData, false);
	if( !this.pendingObjects.hasOwnProperty(key) )
		this.pendingObjects[key] = syncData;
};

jumpStart.prototype.onFirebaseRemoveObject = function(key, syncData)
{
	var object = this.syncedInstances[key];

	if( !object )
		return;

	this.removeSyncedObject(object, false);

//	delete g_SyncedInstances[key];
//	g_NumSyncedInstances--;

//	var object = g_SyncedInstances[key];
//	g_Scene.remove(object);

//	delete g_SyncedInstances[key];
//	g_NumSyncedInstances--;
};

jumpStart.prototype.syncObject = function(sceneObject)
{
	this.prepEventListeners(sceneObject);

	if( !this.syncedInstances.hasOwnProperty(sceneObject.JumpStart.key) )
	{
		this.addSyncedObject(sceneObject);
		return;
	}

	if( this.networkReady )
	{
		// First, copy all updated values from JumpStart into userData.syncData
		var x;
		for( x in sceneObject.JumpStart )
		{
			if( this.noSyncProperties.indexOf(x) !== -1 )
				continue;

			sceneObject.userData.syncData[x] = sceneObject.JumpStart[x];
		}

		if( this.networkReady )
			this.firebaseSync.saveObject(sceneObject);
	}


//	else // DO THIS ALWAYS BECAUSE DATA LISTNERES ARE NOT CALLED ON THE LOCAL PC!!
//	{
		// Otherwise, simulate shit for the data listeners...
		if( this.localDataListeners.hasOwnProperty(sceneObject.uuid) )
		{
			var lastState = this.localDataListeners[sceneObject.uuid];

			// Compare everything
			var x, oldValue;
			for( x in lastState )
			{
				if( lastState[x].oldValue !== sceneObject.JumpStart[x] )
				{
					// something changed!!
					oldValue = lastState[x].oldValue;
					lastState[x].oldValue = sceneObject.JumpStart[x];
					lastState[x].callback.call(sceneObject, oldValue, sceneObject.JumpStart[x], true);
				}
			}
		}
//	}
};

jumpStart.prototype.addDataListener = function(sceneObject, property, callback)
{
	var firebaseProperty = "syncData/" + property;

	// Build this ugly tree asap
	// FIXME: Only VALUE listeners are supported in offline mode.
//	if( !this.networkReady )
//	{
		var treePath = this.localDataListeners;
		if( !treePath.hasOwnProperty(sceneObject.uuid) )
			treePath[sceneObject.uuid] = {};

		treePath = treePath[sceneObject.uuid];

		treePath[property] = {"oldValue": sceneObject.JumpStart[property], "callback": callback};
//	}
//	else
		this.pendingDataListeners.push({"sceneObject": sceneObject, "property": firebaseProperty, "callback": callback});
};

jumpStart.prototype.processPendingDataListeners = function()
{
	var args;
	while( this.pendingDataListeners.length > 0 )
	{
		args = this.pendingDataListeners.pop();

		if( this.options.firebase.appId === "" || this.options.firebase.rootUrl === "" )
			continue;

		//this.firebaseSync.addDataListener(args.sceneObject, args.property, args.callback);
		this.firebaseSync.addDataListener(args.sceneObject, args.property, "value", function(snapshot, eventType) { JumpStart.onDataChangeHandler(snapshot, args.sceneObject, args.callback); });
	}
};

jumpStart.prototype.onDataChangeHandler = function(firebaseSnapshot, sceneObject, callback)
{
	var property = firebaseSnapshot.key();
	if( sceneObject.JumpStart[property] != firebaseSnapshot.val() )
		callback.call(sceneObject, sceneObject.JumpStart[property], firebaseSnapshot.val(), false);
}

jumpStart.prototype.spawnCursorPlane = function(userParams)
{
	// Default params
	var params = {
		"position": new THREE.Vector3(),
		"offset": new THREE.Vector3(),
		"rotation": new THREE.Vector3(),
		"rotate": new THREE.Vector3(),
		"rotateFirst": true,
		"width": this.enclosure.innerWidth,
		"height": this.enclosure.innerHeight
	};

	// Merg user params
	if( arguments.length > 0 )
	{
		var y, x;
		for( x in userParams )
		{
			if( !params.hasOwnProperty(x) )
			{
				console.log("Unknown property in params: " + x);
				continue;
			}

			params[x] = userParams[x];
		}
	}

	// Now create the hit plane
	// color generator from:
	// http://stackoverflow.com/questions/1484506/random-color-generator-in-javascript
	function getRandomColor() {
		var letters = '0123456789abcdef'.split('');
		var color = '#';
		for (var i = 0; i < 6; i++ ) {
			color += letters[Math.floor(Math.random() * 16)];
		}

		return color;
	}

	var depth = 1.0;
	var cursorPlane = new THREE.Mesh(
		new THREE.BoxGeometry(params.width, params.height, depth),
		new THREE.MeshBasicMaterial( { color: getRandomColor(), transparent: true, opacity: 0.5 })
	);
	cursorPlane.geometry.computeBoundingSphere();

	cursorPlane.isCursorPlane = true;
	cursorPlane.position.copy(params.position);
	cursorPlane.rotation.copy(params.rotation);

	if( params.rotateFirst )
	{
		cursorPlane.rotateX(params.rotate.x);
		cursorPlane.rotateY(params.rotate.y);
		cursorPlane.rotateZ(params.rotate.z);
	}

	cursorPlane.translateX(params.offset.x);
	cursorPlane.translateY(params.offset.y);
	cursorPlane.translateZ(params.offset.z - depth / 2.0);

	if( !params.rotateFirst )
	{
		cursorPlane.rotateX(params.rotate.x);
		cursorPlane.rotateY(params.rotate.y);
		cursorPlane.rotateZ(params.rotate.z);
	}

	this.scene.add(cursorPlane);

	return cursorPlane;
};

jumpStart.prototype.onMouseDown = function()
{
	this.onCursorDown();
};

jumpStart.prototype.onCursorDown = function()
{
	if( this.clickedObject )
		this.onCursorUp();

	// FIXME: Add options for how non-JumpStart objects interact with raycasting and mouse events.
	var intersects = this.rayCaster.intersectObjects(this.scene.children, true);

	var sceneObject;
	var x, y;
	for( x in intersects )
	{
		sceneObject = intersects[x].object.parent;
		if( !sceneObject.hasOwnProperty("JumpStart") )
			continue;

		if( (Object.keys(sceneObject.JumpStart.onCursorDown).length !== 0) )
		{
			// Remember what object is clicked.
			this.clickedObject = sceneObject;

			for( y in sceneObject.JumpStart.onCursorDown )
				sceneObject.JumpStart.onCursorDown[y].call(sceneObject);

			// Only ONE object can be clicked at a time.
			break;
		}

		if( sceneObject.blocksLOS )
			break;
	}

	// FIXME: Add a way for user objects to preventDefault on cursor events.
	if( typeof window.onCursorDown === 'function' )
		window.onCursorDown();
};

jumpStart.prototype.onMouseUp = function()
{
	this.onCursorUp();
};

jumpStart.prototype.onCursorUp = function()
{
	var sceneObject = this.clickedObject;

	if( !sceneObject )
		return;

	var x;
	for( x in sceneObject.JumpStart.onCursorUp )
	{
		sceneObject.JumpStart.onCursorUp[x].call(sceneObject);
	}

	this.clickedObject = null;

	// FIXME: Add a way for user objects to preventDefault on cursor events.
	if( typeof window.onCursorUp === 'function' )
		window.onCursorUp();
};

jumpStart.prototype.onMouseMove = function(e)
{
	if( !this.webMode )
		return;

	// Fill with 2D position for now
	var mouse3D = new THREE.Vector3(0, 0, 0);
	mouse3D.x = (e.clientX / window.innerWidth) * 2 - 1;
	mouse3D.y = -(e.clientY / window.innerHeight) * 2 + 1;
	mouse3D.z = 0.5;

	// Convert the 2D position to a 3D point
	mouse3D.unproject(this.camera);

	// Get a look vector from the camera to mouse3D
	var direction = new THREE.Vector3();
	direction = mouse3D.sub(this.camera.position).normalize();

	this.futureCursorRay = { "origin": this.camera.position, "direction": direction };
}

jumpStart.prototype.onCursorMove = function(e)
{
	this.futureCursorRay = e.cursorRay;
};

jumpStart.prototype.processCursorMove = function()
{
	if( !this.options.enabledCursorEvents.cursorMove )
		return;

	// Check if cursor has moved (OBSOLETE: WE MUST ALWAYS RAYCAST BECAUSE OBJECTS MOVE TOO!!)
	/*
	if( !this.futureCursorRay || (this.futureCursorRay.origin === this.cursorRay.origin &&
			this.futureCursorRay.direction === this.cursorRay.direction) )
		return;
	*/

	this.cursorRay = this.futureCursorRay;

	// Update the local user's look info
	this.localUser.lookOrigin.copy(this.cursorRay.origin);
	this.localUser.lookDirection.copy(this.cursorRay.direction);

	// Set the raycaster
	this.rayCaster.set( this.cursorRay.origin, this.cursorRay.direction );

	// FIXME: TWO OPTIONS
	// A. Build a list of every eligible scene object THEN raycast.
	// B. Raycast, then filter for eligible objects.
	// Currently using option B cuz its like 3am right now...

	var intersects = this.rayCaster.intersectObjects(this.scene.children, true);

	function unhoverObject(sceneObject)
	{
		var y;
		for( y in sceneObject.JumpStart.onCursorLeave )
			sceneObject.JumpStart.onCursorLeave[y].call(sceneObject);
	}

	this.localUser.lookHit = null;
	var oldHoveredObject = this.hoveredObject;
	var x, sceneObject, futureHoverObject, y;
	for( x in intersects )
	{
		if( intersects[x].object.hasOwnProperty("isCursorPlane") )
		{
			var goodPoint = true;

			// Make sure it's a INWARD surface
			var face = intersects[x].face;
			if( !(face.a === 5 &&
				face.b === 7 &&
				face.c === 0) &&
				!(face.a === 7 &&
				face.b === 2 &&
				face.c === 0) )
			{
				goodPoint = false;
			}


			if( goodPoint )
			{
				if( this.hoveredObject )
				{
					unhoverObject(this.hoveredObject);
					this.hoveredObject = null;
				}

				this.localUser.lookHit = intersects[x];

				// FIXME: Figure out what's up with Altspace scene scaling.
				var scaledPoint = new THREE.Vector3().copy(this.localUser.lookHit.point).multiplyScalar(1/this.worldScale);
				this.localUser.lookHit.scaledPoint = scaledPoint;
				break;
			}
		}
		else
		{
			sceneObject = intersects[x].object.parent;

			if( sceneObject.hasOwnProperty("JumpStart") && sceneObject.JumpStart.blocksLOS )
			{
				if( (this.options.enabledCursorEvents.cursorEnter &&
					Object.keys(sceneObject.JumpStart.onCursorEnter).length !== 0) ||
					(this.options.enabledCursorEvents.cursorLeave) &&
					Object.keys(sceneObject.JumpStart.onCursorLeave).length !== 0)
				{
					if( this.hoveredObject && this.hoveredObject !== sceneObject )
					{
						unhoverObject(this.hoveredObject);
						this.hoveredObject = null;
					}

					// Now set this new object as hovered
					for( y in sceneObject.JumpStart.onCursorEnter )
						sceneObject.JumpStart.onCursorEnter[y].call(sceneObject);

					this.hoveredObject = sceneObject;
					this.localUser.lookHit = intersects[x];

					// FIXME: Figure out what's up with Altspace scene scaling.
					var scaledPoint = new THREE.Vector3().copy(this.localUser.lookHit.point).multiplyScalar(1/this.worldScale);
					this.localUser.lookHit.scaledPoint = scaledPoint;
					break;
				}
				else
				{
					this.localUser.lookHit = intersects[x];

					// FIXME: Figure out what's up with Altspace scene scaling.
					var scaledPoint = new THREE.Vector3().copy(this.localUser.lookHit.point).multiplyScalar(1/this.worldScale);
					this.localUser.lookHit.scaledPoint = scaledPoint;
					break;
				}
			}
		}
	}

	if( !this.localUser.lookHit && this.hoveredObject )
	{
		unhoverObject(this.hoveredObject);
		this.hoveredObject = null;
	}
	else if( this.crosshair && this.localUser.lookHit )
	{
		this.crosshair.position.copy(this.localUser.lookHit.point);

		var normalMatrix = new THREE.Matrix3().getNormalMatrix( this.localUser.lookHit.object.matrixWorld );
		var worldNormal = this.localUser.lookHit.face.normal.clone().applyMatrix3( normalMatrix ).normalize();
		worldNormal.add(this.localUser.lookHit.point);

		this.crosshair.lookAt(worldNormal);
		this.crosshair.position.multiplyScalar(this.enclosure.innerHeight / this.enclosure.adjustedHeight);	// FIXME Probably can replace this with / this.worldScale
	}

	g_lookHit = this.localUser.lookHit;

	if( !this.localUser.lookHit )
		this.crosshair.scale.set(0.0001, 0.0001, 0.0001);
	else
		this.crosshair.scale.set(1, 1, 1);
};

jumpStart.prototype.initiate = function()
{
	if( this.altContentAlreadyLoaded )
		return;

	this.altContentAlreadyLoaded = true;

	this.worldScale = this.options["worldScale"];

	if( this.webMode )
	{
		//this.enclosure = { "innerWidth": window.innerWidth / 3.0, "innerHeight": window.innerHeight / 3.0, "innerDepth": window.innerWidth / 3.0 };
		var commonVal = Math.round(1024 / 2.5);
		this.enclosure = {
			"innerWidth": commonVal,
			"innerHeight": commonVal,
			"innerDepth": commonVal,
			"adjustedWidth": commonVal,
			"adjustedHeight": commonVal,
			"adjustedDepth": commonVal,
			"scaledWidth": Math.round(commonVal * (1 / this.worldScale)),
			"scaledHeight": Math.round(commonVal * (1 / this.worldScale)),
			"scaledDepth": Math.round(commonVal * (1 / this.worldScale))
		};
		this.localUser = { "userId": "WebUser" + Date.now(), "displayName": "WebUser" };

		this.localUser.displayName = "WebUser" + Date.now();
//		if( this.options.debugMode )
//			this.localUser.displayName = "Flynn";
		/* don't ask until after init
		else
		{
			while( this.localUser.displayName === "WebUser" || this.localUser.displayName === "" )
				this.localUser.displayName = prompt("Enter a player name:", "");

			if( !this.localUser.displayName || this.localUser.displayName === "WebUser" || this.localUser.displayName === "" )
			{
				window.history.back();
				return;
			}
		}
		*/
	}
	else
	{
		// Altspace has a different style of scaling
		this.worldScale *= 3.0;

		this.enclosure.adjustedWidth = Math.round(this.enclosure.innerWidth * JumpStart.worldScale);
		this.enclosure.adjustedHeight = Math.round(this.enclosure.innerWidth * JumpStart.worldScale);
		this.enclosure.adjustedDepth = Math.round(this.enclosure.innerDepth * JumpStart.worldScale);

		this.enclosure.scaledWidth = Math.round(this.enclosure.innerWidth * (1 / JumpStart.worldScale));
		this.enclosure.scaledHeight = Math.round(this.enclosure.innerWidth * (1 / JumpStart.worldScale));
		this.enclosure.scaledDepth = Math.round(this.enclosure.innerDepth * (1 / JumpStart.worldScale));
	}

//	this.enclosure.bounds = {};
//	this.enclosure.bounds.bottomCenter = new THREE.Vector3(0, (-this.enclosure.innerHeight / 2.0) * scaledRatio, 0);

	if( this.options.legacyLoader )
		this.objectLoader = new THREE.AltOBJMTLLoader();
	else
		this.objectLoader = new THREE.OBJMTLLoader();

	this.scene = new THREE.Scene();
	this.scene.scale.multiplyScalar(this.worldScale);

	this.clock = new THREE.Clock();
	this.rayCaster = new THREE.Raycaster();

	// FIXME: Why is this a spoofed ray?  Is it needed for web mode?
	this.cursorRay = {"origin": new THREE.Vector3(), "direction": new THREE.Vector3()};
	this.futureCursorRay = {"origin": new THREE.Vector3(), "direction": new THREE.Vector3()};

	this.localUser.lookOrigin = new THREE.Vector3();
	this.localUser.lookDirection = new THREE.Vector3();
	this.localUser.firstUser = true;

	var scaledRatio = this.enclosure.innerHeight / this.enclosure.adjustedHeight;
	this.worldOffset = new THREE.Vector3(0.0, (-this.enclosure.innerHeight / 2.0) * scaledRatio, 0.0);

	if ( this.webMode )
	{
		this.renderer = new THREE.WebGLRenderer();
		this.renderer.setClearColor("#AAAAAA");
		this.renderer.setSize( window.innerWidth, window.innerHeight );
		document.body.appendChild( this.renderer.domElement );

		var aspect = window.innerWidth / window.innerHeight;
		this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 2000 );

		this.camera.position.copy(this.options.camera.position);
		this.camera.position.add(this.worldOffset);

		if( this.options.camera.lookAtOrigin )
		{
			var origin = new THREE.Vector3();
			origin.copy(this.scene.position);
			origin.add(this.worldOffset);

			this.camera.lookAt( origin );
		}

		this.camera.translateX(this.options.camera.translation.x);
		this.camera.translateY(this.options.camera.translation.y);
		this.camera.translateZ(this.options.camera.translation.z);

		// OBJMTLLoader always uses PhongMaterial, so we need light in scene.
		var ambient = new THREE.AmbientLight( 0xffffff );
		this.scene.add( ambient );
	}
	else
	{
		this.scene.addEventListener( "cursormove", function(e) { JumpStart.onCursorMove(e); });

		if( this.options.legacyLoader )
			this.renderer = altspace.getThreeJSRenderer({version:'0.1.0'});
		else
			this.renderer = altspace.getThreeJSRenderer({version:'0.2.0'});
	}

	// Create some invisible planes for raycasting.
	if( this.options.enabledCursorEvents.bottomPlane )
	{
		console.log("creating bottom plane");
		var pos = new THREE.Vector3().copy(this.worldOffset);
		pos.y += 0.5;

		var bottomPlane = JumpStart.spawnCursorPlane({
			"position": pos,
			"rotate": new THREE.Vector3(-Math.PI / 2.0, 0, 0),
			"width": this.enclosure.innerWidth,
			"height": this.enclosure.innerDepth
		});

		// Save this for users to use
		this.floorPlane = bottomPlane;
	}

	if( this.options.enabledCursorEvents.topPlane )
	{
		var topPlane = JumpStart.spawnCursorPlane({
			"position": new THREE.Vector3(this.worldOffset.x, -this.worldOffset.y, this.worldOffset.z),
			"rotate": new THREE.Vector3(Math.PI / 2.0, 0, 0),
			"width": this.enclosure.innerWidth,
			"height": this.enclosure.innerDepth
		});
	}

	if( this.options.enabledCursorEvents.northPlane )
	{
		var northPlane = JumpStart.spawnCursorPlane({
			"position": new THREE.Vector3(0, 0, this.worldOffset.y),
			"rotate": new THREE.Vector3(0, 0, 0),
			"width": this.enclosure.innerWidth,
			"height": this.enclosure.innerDepth
		});
	}

	if( this.options.enabledCursorEvents.southPlane )
	{
		var southPlane = JumpStart.spawnCursorPlane({
			"position": new THREE.Vector3(0, 0, -this.worldOffset.y),
			"rotate": new THREE.Vector3(0, Math.PI, 0),
			"width": this.enclosure.innerWidth,
			"height": this.enclosure.innerDepth
		});
	}

	if( this.options.enabledCursorEvents.westPlane )
	{
		var westPlane = JumpStart.spawnCursorPlane({
			"position": new THREE.Vector3(this.worldOffset.y, 0, 0),
			"rotate": new THREE.Vector3(0, Math.PI / 2.0, 0),
			"width": this.enclosure.innerWidth,
			"height": this.enclosure.innerDepth
		});
	}

	if( this.options.enabledCursorEvents.eastPlane )
	{
		var eastPlane = JumpStart.spawnCursorPlane({
			"position": new THREE.Vector3(-this.worldOffset.y, 0, 0),
			"rotate": new THREE.Vector3(0, -Math.PI / 2.0, 0),
			"width": this.enclosure.innerWidth,
			"height": this.enclosure.innerDepth
		});
	}

	g_localUser = this.localUser;
	g_worldOffset = this.worldOffset;
	g_worldScale = this.worldScale;
	g_objectLoader = this.objectLoader;
	g_camera = this.camera;
	g_renderer = this.renderer;
	g_scene = this.scene;
	g_clock = this.clock;
	g_rayCaster = this.rayCaster;
	g_enclosure = this.enclosure;
	g_deltaTime = this.deltaTime;
	g_numSyncedInstances = this.numSyncedInstances;
	g_initialSync = this.initialSync;
	g_floorPlane = this.floorPlane;

	// We are ready to rock-n-roll!!
	this.initialized = true;

	// Load our crosshair
	this.loadModels("models/JumpStart/crosshair.obj").then(function()
	{
		// Spawn it in
		var crosshair = JumpStart.spawnInstance("models/JumpStart/crosshair.obj");
		crosshair.JumpStart.blocksLOS = false;
		//crosshair.scale.multiplyScalar(1.0);

		crosshair.JumpStart.onTick = function()
		{
			if( !this.hasOwnProperty('spinAmount') || this.spinAmount >= Math.PI * 2.0 )
				this.spinAmount = 0.0;

			this.spinAmount += 1.0 * g_deltaTime;
			this.rotateZ(this.spinAmount);
		};

		JumpStart.crosshair = crosshair;
		g_crosshair = JumpStart.crosshair;

		if( !JumpStart.webMode )
		{
			crosshair.addEventListener("cursordown", function(e) { JumpStart.pendingClick = true; });
			crosshair.addEventListener("cursorup", function(e) { JumpStart.pendingClickUp = true; });
		}

		function prepPrecache()
		{
			// WE ALSO HAVE SOME STUFF TO "CACHE" IF IN DEBUG MODE...
			// Inject the css if in debug mode
			if( JumpStart.options.debugMode )
			{
				JumpStart.debugui = new jumpStartDebugUI();

				var templateElem = document.getElementById("JumpStartDebugElements");
				if( templateElem )
				{
					var container = document.createElement("div");
					container.innerHTML = templateElem.innerHTML;
					document.body.appendChild(container);
				}
			}

			// User global, if it exists.
			if( window.hasOwnProperty("onPrecache") )
				onPrecache();
			else
				JumpStart.doneCaching();
		}

		// Wait for us to get our room key
		if( JumpStart.options.firebase.rootUrl !== "" && JumpStart.options.firebase.appId !== "" )
		{
			var myHandle = setInterval(function()
			{
				if( JumpStart.firebaseSync.roomKey === null )
					return;

				var membersRef = JumpStart.firebaseSync.firebaseRoot.child(JumpStart.firebaseSync.appId).child('rooms').child(JumpStart.firebaseSync.roomKey).child('members');
				membersRef.once("value", function(snapshot) {
					var members = snapshot.val();

					var count = 0;
					var x;
					for( x in members )
						count++;
console.log("Member count: " + count);
					if( count > 0 )
						JumpStart.localUser.firstUser = false;

					// Now we're ready for game logic
					prepPrecache();
				});

				clearInterval(myHandle);
			}, 100);
		}
		else
			prepPrecache();
	});
}

jumpStart.prototype.doneCaching = function()
{
	// Spawn any synced objects that already exist on the server...
	// DO WORK FIXME

	var index;
	for( index in this.pendingObjects )
		this.networkSpawn(index, this.pendingObjects[index], true);

	this.initialSync = false;

	if( window.hasOwnProperty("onReady") )
		onReady();
	else
		console.log("Your app is ready, but you have no onReady callback function!");
};

jumpStart.prototype.networkSpawn = function(key, syncData, isInitial)
{
	// 1. Copy everything that exists in syncData into JumpStart
	// 2. If there are any event listeners named, apply them to the object.

	if( this.pendingObjects.hasOwnProperty(key) )
		delete this.pendingObjects[key];

	var instance = this.spawnInstance(syncData.modelFile, {'key': key, 'syncData': syncData});

	this.updateJumpStartProperties(instance, syncData);

	// If the object has a spawn listener, NOW is the time...
	for( x in instance.JumpStart.onSpawn )
		instance.JumpStart.onSpawn[x].call(instance, false, isInitial);	// FIXME: This isInital flag is bullshit!!

	instance.JumpStart.key = key;
	this.syncedInstances[key] = instance;
	this.numSyncedInstances++;

	return instance;
};

jumpStart.prototype.updateJumpStartProperties = function(instance, syncData)
{
	var needsAppliedForce = false;

	var x, y;
	for( x in syncData )
	{
		if( !instance.JumpStart.hasOwnProperty(x) && typeof syncData[x] === 'object' )
		{
			// Try to determine which type of object it is
			if( syncData[x].hasOwnProperty('x') && syncData[x].hasOwnProperty('y') && syncData[x].hasOwnProperty('z') )
				instance.JumpStart[x] = new THREE.Vector3();
			else
				instance.JumpStart[x] = {};
		}

		if( typeof syncData[x] === 'object' )
		{
			for( y in syncData[x] )
				instance.JumpStart[x][y] = syncData[x][y];
		}
		else
		{
			// Apply any force that is needed
			if( x === "physicsState" && syncData[x] !== instance.JumpStart.physicsState )
				needsAppliedForce = true;

			// Copy the value over like regular
			instance.JumpStart[x] = syncData[x];
		}
	}

	if( needsAppliedForce && instance.JumpStart.hasOwnProperty("velocity") )
		instance.JumpStart.velocity.add(instance.JumpStart.appliedForce);

	if( syncData.hasOwnProperty('networkRemovedListeners') )
	{
		for( x in syncData.networkRemovedListeners )
		{
			// Just replace ALL listeners, and we'll end up as the one named 'default'.
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				instance.JumpStart.onNetworkRemoved = {};
				instance.JumpStart.onNetworkRemoved[x] = window[x];
			}

			break;
		}
	}
	else
	{
		// If the object has an onSpawn listener that isn't named default, then clear it!
		for( x in instance.JumpStart.onNetworkRemoved )
		{
			if( x !== "default" )
				instance.JumpStart.onNetworkRemoved = {};

			break;
		}
	}

	if( syncData.hasOwnProperty('spawnListeners') )
	{
		for( x in syncData.spawnListeners )
		{
			// Just replace ALL listeners, and we'll end up as the one named 'default'.
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				instance.JumpStart.onSpawn = {};
				instance.JumpStart.onSpawn[x] = window[x];
			}

			break;
		}
	}
	else
	{
		// If the object has an onSpawn listener that isn't named default, then clear it!
		for( x in instance.JumpStart.onSpawn )
		{
			if( x !== "default" )
				instance.JumpStart.onSpawn = {};

			break;
		}
	}

	if( syncData.hasOwnProperty('tickListeners') )
	{
		for( x in syncData.tickListeners )
		{
			// Just replace ALL listeners, and we'll end up as the one named 'default'.
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				instance.JumpStart.onTick = {};
				instance.JumpStart.onTick[x] = window[x];
			}

			break;
		}
	}
	else
	{
		// If the object has an onSpawn listener that isn't named default, then clear it!
		for( x in instance.JumpStart.onTick )
		{
			if( x !== "default" )
				instance.JumpStart.onTick = {};

			break;
		}
	}

	if( syncData.hasOwnProperty('cursorDownListeners') )
	{
		for( x in syncData.cursorDownListeners )
		{
			// Just replace ALL listeners, and we'll end up as the one named 'default'.
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				instance.JumpStart.onCursorDown = {};
				instance.JumpStart.onCursorDown[x] = window[x];
			}

			break;
		}
	}
	else
	{
		// If the object has an onSpawn listener that isn't named default, then clear it!
		for( x in instance.JumpStart.onCursorDown )
		{
			if( x !== "default" )
				instance.JumpStart.onCursorDown = {};

			break;
		}
	}

	if( syncData.hasOwnProperty('cursorUpListeners') )
	{
		for( x in syncData.cursorUpListeners )
		{
			// Just replace ALL listeners, and we'll end up as the one named 'default'.
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				instance.JumpStart.onCursorUp = {};
				instance.JumpStart.onCursorUp[x] = window[x];
			}

			break;
		}
	}
	else
	{
		// If the object has an onSpawn listener that isn't named default, then clear it!
		for( x in instance.JumpStart.onCursorUp )
		{
			if( x !== "default" )
				instance.JumpStart.onCursorUp = {};

			break;
		}
	}

	if( syncData.hasOwnProperty('cursorEnterListeners') )
	{
		for( x in syncData.cursorEnterListeners )
		{
			// Just replace ALL listeners, and we'll end up as the one named 'default'.
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				instance.JumpStart.onCursorEnter = {};
				instance.JumpStart.onCursorEnter[x] = window[x];
			}

			break;
		}
	}
	else
	{
		// If the object has an onSpawn listener that isn't named default, then clear it!
		for( x in instance.JumpStart.onCursorEnter )
		{
			if( x !== "default" )
				instance.JumpStart.onCursorEnter = {};

			break;
		}
	}

	if( syncData.hasOwnProperty('cursorLeaveListeners') )
	{
		for( x in syncData.cursorLeaveListeners )
		{
			// Just replace ALL listeners, and we'll end up as the one named 'default'.
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				instance.JumpStart.onCursorLeave = {};
				instance.JumpStart.onCursorLeave[x] = window[x];
			}

			break;
		}
	}
	else
	{
		// If the object has an onSpawn listener that isn't named default, then clear it!
		for( x in instance.JumpStart.onCursorLeave )
		{
			if( x !== "default" )
				instance.JumpStart.onCursorLeave = {};

			break;
		}
	}
};

jumpStart.prototype.run = function()
{
	// Start the game loop
	this.onTick();
};

jumpStart.prototype.onTick = function()
{
	function recursive(parentObject)
	{
		var sceneObject;
		var x, y, z;
		for( x in parentObject.children )
		{
			sceneObject = parentObject.children[x];
			if( !sceneObject.hasOwnProperty("JumpStart") )
				continue;

			// Fix up anything the local app dev assigned to listeners
			this.prepEventListeners(sceneObject);

			// Sync current state with network state
			//if( sceneObject.userData.hasOwnProperty("syncData") )
			if( sceneObject.JumpStart.hasOwnProperty("key") && typeof this.syncedInstances[sceneObject.JumpStart.key] !== 'undefined' )
				this.updateJumpStartProperties(sceneObject, sceneObject.userData.syncData);

			if( sceneObject.JumpStart.hasOwnProperty("physicsState") && sceneObject.JumpStart.physicsState !== 0 )
			{
				// Sense velocity is not synced, make sure it exists on anything that needs it.
				if( !sceneObject.JumpStart.hasOwnProperty("velocity") )
					sceneObject.JumpStart.velocity = new THREE.Vector3(0, 0, 0);

				var state = sceneObject.JumpStart.physicsState;
				if( state === 1 )
				{
					// Gravity is a bit much, so cut it in half.
					sceneObject.JumpStart.velocity.y -= 9.8 * g_deltaTime;
				}

				// Terminal velocity because we have no air drag
				if( sceneObject.JumpStart.velocity.length() > 5.0 )
				{
					sceneObject.JumpStart.velocity.normalize().multiplyScalar( 5.0 );
				}

				// Update the rotation
				sceneObject.rotateX((sceneObject.JumpStart.freefallRot.x * 5.0) * this.deltaTime);
				sceneObject.rotateY((sceneObject.JumpStart.freefallRot.y * 5.0) * this.deltaTime);
				sceneObject.rotateZ((sceneObject.JumpStart.freefallRot.z * 5.0) * this.deltaTime);

				// Bounce us off of walls
				var maxWidth = this.enclosure.scaledDepth / 2;
				var maxHeight = this.enclosure.scaledHeight / 2;
				var maxDepth = this.enclosure.scaledDepth / 2;

				if( sceneObject.position.x > maxWidth )
				{
					sceneObject.position.x = maxWidth;
					sceneObject.JumpStart.velocity.x = -sceneObject.JumpStart.velocity.x;
				}
				else if( sceneObject.position.x < -maxWidth )
				{
					sceneObject.position.x = -maxWidth;
					sceneObject.JumpStart.velocity.x = -sceneObject.JumpStart.velocity.x;
				}

				if( sceneObject.position.z > maxDepth )
				{
					sceneObject.position.z = maxDepth;
					sceneObject.JumpStart.velocity.z = -sceneObject.JumpStart.velocity.z;
				}
				else if( sceneObject.position.z < -maxDepth )
				{
					sceneObject.position.z = -maxDepth;
					sceneObject.JumpStart.velocity.z = -sceneObject.JumpStart.velocity.z;
				}

				if( sceneObject.position.y > maxHeight )
				{
					sceneObject.position.y = maxHeight;
					sceneObject.JumpStart.velocity.y = -sceneObject.JumpStart.velocity.y;
				}
				else if( sceneObject.position.y < -maxHeight )
				{
					sceneObject.position.y = -maxHeight;
					sceneObject.JumpStart.velocity.y = -sceneObject.JumpStart.velocity.y;
				}

				sceneObject.position.add(sceneObject.JumpStart.velocity);
			}

			if( sceneObject.JumpStart.hasOwnProperty("onTick") )
			{
				for( y in sceneObject.JumpStart.onTick )
					sceneObject.JumpStart.onTick[y].call(sceneObject);
			}

			if( sceneObject.children.length > 0 )
				recursive.call(this, sceneObject);
		}
	}

	if( !this.initialized )
		return;

	// Spawn anything that needs to be spawned
	var index;
	for( index in this.pendingObjects )
		this.networkSpawn(index, this.pendingObjects[index], false);

	this.processPendingDataListeners();

	this.deltaTime = this.clock.getDelta();
	g_deltaTime = this.deltaTime;

	// FIXME: We should really prep event listeners before processing cursor move, in case any of them have new listeners assigned with the = function syntax.
	this.processCursorMove();

	// FIXME: PLACEHOLDER FOR REAL INPUT EVENTS!!
	if( this.pendingClick )
	{
		this.onCursorDown();
		this.pendingClick = false;
	}
	else if( this.pendingClickUp )
	{
		this.onCursorUp();
		this.pendingClickUp = false;
	}

	if( this.pendingEventA )
	{
		this.pendingEventA();
		this.pendingEventA = null;
	}

	if( window.hasOwnProperty("onTick") )
		onTick();

	requestAnimationFrame( function(){ JumpStart.onTick(); } );

	recursive.call(this, this.scene);

	this.renderer.render( this.scene, this.camera );
};

jumpStart.prototype.onWindowResize = function()
{
	if( !JumpStart.webMode )
		return;

	JumpStart.camera.aspect = window.innerWidth / window.innerHeight;
	JumpStart.camera.updateProjectionMatrix();
	JumpStart.renderer.setSize( window.innerWidth, window.innerHeight );
};

jumpStart.prototype.setOptions = function(options)
{
	if( this.initialized )
	{
		console.log("Options cannot be changed after JumpStart has been initialized.");
		return;
	}

	var y;
	var x;
	for( x in options )
	{
		// Only handle options that exist.
		if( !this.options.hasOwnProperty(x) )
			continue;

		if( typeof options[x] !== 'object' )
			this.options[x] = options[x];
		else
		{
			for( y in options[x] )
			{
				// Only handle options that exist.
				if( !this.options[x].hasOwnProperty(y) )
					continue;

				this.options[x][y] = options[x][y];
			}
		}
	}

	// Determine if we must raycast every cursor move:
	if( this.options.enabledCursorEvents.cursorEnter || this.options.enabledCursorEvents.cursorLeave )
		this.options.enabledCursorEvents.cursorMove = true;
};

jumpStart.prototype.loadModels = function()
{
	// Handle various argument types.
	var models;
	if( Array.isArray(arguments[0]) )
		models = arguments[0];
	else if( arguments.length === 1 )
		models = [arguments[0]];
	else
		models = arguments;

	this.modelLoader.batchName = "batch" + Date.now();

	var x;
	for( x in models )
	{
		var fileName = models[x];
		JumpStart.models.push({"fileName": fileName, "batchName": JumpStart.modelLoader.batchName});
		
		if( JumpStart.options.legacyLoader )
			JumpStart.objectLoader.load(fileName, JumpStart.modelLoader.batchCallbackFactory(fileName, JumpStart.modelLoader.batchName));
		else
			JumpStart.objectLoader.load(fileName, fileName.substring(0, fileName.length - 3) + "mtl", JumpStart.modelLoader.batchCallbackFactory(fileName, JumpStart.modelLoader.batchName));
	}

	return {
		"then": function(callback)
		{
			JumpStart.modelLoader.callbacks[JumpStart.modelLoader.batchName] = callback;
		}
	};
};

jumpStart.prototype.spawnInstance = function(fileName, userOptions)
{
	var options = {
		"parent": null,
		"key": "",
		"syncData": null
	};

	if( typeof userOptions !== 'undefined' )
	{
		// Merg user args
		var x;
		for( x in userOptions )
		{
			// Only handle options that exist.
			if( !options.hasOwnProperty(x) )
				continue;

			options[x] = userOptions[x];
		}
	}

	// Make sure the fileName is a cached model.
	// do work

	var clone;
	var x;
	for( x in this.models )
	{
		if( this.models[x].fileName === fileName && this.models[x].hasOwnProperty("object") )
		{
			// Clone the model
			clone = this.models[x].object.clone();

			// Set the position
			if( !options.parent )
				clone.position.copy(this.worldOffset);

			// Set the orientation
			clone.rotation.set(0.0, 0.0, 0.0);

			// Add the instance to the scene
			if( !options.parent )
				this.scene.add(clone);
			else
				options.parent.add(clone);

			this.prepInstance.call(clone, fileName);

			if( !this.webMode )
			{
				clone.addEventListener("cursordown", function(e) { JumpStart.pendingClick = true; });
				clone.addEventListener("cursorup", function(e) { JumpStart.pendingClickUp = true; });
			}

			// Add this object to the synced instance list
//			/*
			if( options.key !== "" )
			{
				this.syncedInstances[options.key] = clone;
				clone.JumpStart.key = options.key;
				this.numSyncedInstances++;
				g_numSyncedInstances = this.numSyncedInstances;

				this.firebaseSync.addObject(clone, options.key, options.syncData);
			}
//			*/
			
//			console.log("Spawned an object");

			return clone;
		}
	}

	console.log("Model is not precached" + fileName);

	return null;
};

jumpStart.prototype.prepInstance = function(modelFile)
{
	var sceneObject = this;

	// TODO: Sync event handlers if dev desires (object name = callback function name)

	// Prepare it to get callback logic.
	sceneObject.JumpStart =
	{
		"onNetworkRemoved": {},
		"onSpawn": {},
		"onTick": {},
		"onCursorDown": {},
		"onCursorUp": {},
		"onCursorEnter": {},
		"onCursorLeave": {},
		"networkRemoved": {},
		"spawnListeners": {},
		"tickListeners": {},
		"cursorDownListeners": {},
		"cursorUpListeners": {},
		"cursorEnterListeners": {},
		"cursorLeaveListeners": {},
		"blocksLOS": true,
		"tintColor": new THREE.Color(),
//		"physicsFlags": 0x0,	// 0 = disabled, 0x1 = atrest, 0x2 = freefall
//		"thrust": new THREE.Vector3(0, 0, 0),
//		"freefallRotate": new THREE.Vector3((Math.PI / 2.0) * Math.random(), (Math.PI / 2.0) * Math.random(), (Math.PI / 2.0) * Math.random()),
		"hasCursorEffects": 0x0,	// Used to optimize raycasting as well as attach window-level listeners to objects, if desired.
		"modelFile": modelFile,
		"setTint": function(tintColor)
		{
			if( JumpStart.webMode )
			{
				var x, mesh;
				for( x in this.children )
				{
					mesh = this.children[x];

					if( mesh.material && mesh.material instanceof THREE.MeshPhongMaterial )
						mesh.material.ambient = tintColor;
				}
			}
			else
			{
				var altspaceTintColor = {"r": tintColor.r * 0.5, "g": tintColor.g * 0.5, "b": tintColor.b * 0.5};

				this.userData.tintColor = altspaceTintColor;

				this.traverse(function(child)
				{
					this.userData.tintColor = altspaceTintColor;
				}.bind(this));
			}
		}.bind(this),
		"addDataListener": function(property, listener)
		{
			JumpStart.addDataListener(this, property, listener);
		}.bind(this),
		"sync": function()
		{
			JumpStart.syncObject(this);
		}.bind(this),
		"applyForce": function(force)
		{
			JumpStart.applyForce(this, force);
		}.bind(this),
		"makePhysics": function()
		{
			JumpStart.makePhysics(this);
		}.bind(this),
		"makeStatic": function()
		{
			JumpStart.makeStatic(this);
		}.bind(this)
		/*
		"setModel": function(userModelName)
		{
			// FIXME: setGeometry was removed from THREE.js, need a better implementation.
			// Such as a JumpStart.clone method that will clone all JumpStart properties & callbacks along with regular stuff.
			var x;
			for( x in JumpStart.models )
			{
				if( JumpStart.models[x].fileName === fileName && JumpStart.models[x].hasOwnProperty("object") )
				{
					this
				}
			}
		}.bind(this)
		*/
	};
};

jumpStart.prototype.prepEventListeners = function(sceneObject, inEventName)
{
	var eventName = null;
	if( typeof inEventName === 'string' )
		eventName = inEventName;

	var x;
	if( !eventName || eventName === 'networkRemoved' )
	{
		sceneObject.JumpStart.networkRemovedListeners = {};

		if( typeof sceneObject.JumpStart.onNetworkRemoved === 'function' )
			sceneObject.JumpStart.onNetworkRemoved = {'default': sceneObject.JumpStart.onNetworkRemoved};

		// FIXME: Only supporting 1 event callback. Should support N.
		for( x in sceneObject.JumpStart.onNetworkRemoved )
		{
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				sceneObject.JumpStart.networkRemovedListeners[x] = x;
				break;
			}
		}
	}

	if( !eventName || eventName === 'spawn' )
	{
		sceneObject.JumpStart.spawnListeners = {};

		if( typeof sceneObject.JumpStart.onSpawn === 'function' )
			sceneObject.JumpStart.onSpawn = {'default': sceneObject.JumpStart.onSpawn};

		// FIXME: Only supporting 1 event callback. Should support N.
		for( x in sceneObject.JumpStart.onSpawn )
		{
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				sceneObject.JumpStart.spawnListeners[x] = x;
				break;
			}
		}
	}

	if( !eventName || eventName === 'tick' )
	{
		sceneObject.JumpStart.tickListeners = {};

		if( typeof sceneObject.JumpStart.onTick === 'function' )
			sceneObject.JumpStart.onTick = {'default': sceneObject.JumpStart.onTick};

		// FIXME: Only supporting 1 event callback. Should support N.
		for( x in sceneObject.JumpStart.onTick )
		{
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				sceneObject.JumpStart.tickListeners[x] = x;
				break;
			}
		}
/*
		if( sceneObject.userData.syncData )
		{
			var syncData = sceneObject.userData.syncData;

			if( syncData.hasOwnProperty("tickListeners") )
				delete syncData.tickListeners;
		}
		*/
	}

	if( !eventName || eventName === 'cursordown' )
	{
		sceneObject.JumpStart.cursorDownListeners = {};

		if( typeof sceneObject.JumpStart.onCursorDown === 'function' )
			sceneObject.JumpStart.onCursorDown = {'default': sceneObject.JumpStart.onCursorDown};

		// FIXME: Only supporting 1 event callback. Should support N.
		for( x in sceneObject.JumpStart.onCursorDown )
		{
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				sceneObject.JumpStart.cursorDownListeners[x] = x;
				break;
			}
		}
	}

	if( !eventName || eventName === 'cursorup' )
	{
		sceneObject.JumpStart.cursorUpListeners = {};

		if( typeof sceneObject.JumpStart.onCursorUp === 'function' )
			sceneObject.JumpStart.onCursorUp = {'default': sceneObject.JumpStart.onCursorUp};

		// FIXME: Only supporting 1 event callback. Should support N.
		for( x in sceneObject.JumpStart.onCursorUp )
		{
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				sceneObject.JumpStart.cursorUpListeners[x] = x;
				break;
			}
		}
/*
		if( sceneObject.userData.syncData )
		{
			var syncData = sceneObject.userData.syncData;

			if( syncData.hasOwnProperty("cursorUpListeners") )
				delete syncData.cursorUpListeners;
		}
		*/
	}

	if( !eventName || eventName === 'cursorenter' )
	{
		sceneObject.JumpStart.cursorEnterListeners = {};

		if( typeof sceneObject.JumpStart.onCursorEnter === 'function' )
			sceneObject.JumpStart.onCursorEnter = {'default': sceneObject.JumpStart.onCursorEnter};

		// FIXME: Only supporting 1 event callback. Should support N.
		for( x in sceneObject.JumpStart.onCursorEnter )
		{
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				sceneObject.JumpStart.cursorEnterListeners[x] = x;
				break;
			}
		}
/*
		if( sceneObject.userData.syncData )
		{
			var syncData = sceneObject.userData.syncData;

			if( syncData.hasOwnProperty("cursorEnterListeners") )
				delete syncData.cursorEnterListeners;
		}
		*/
	}

	if( !eventName || eventName === 'cursorleave' )
	{
		sceneObject.JumpStart.cursorLeaveListeners = {};

		if( typeof sceneObject.JumpStart.onCursorLeave === 'function' )
			sceneObject.JumpStart.onCursorLeave = {'default': sceneObject.JumpStart.onCursorLeave};

		// FIXME: Only supporting 1 event callback. Should support N.
		for( x in sceneObject.JumpStart.onCursorLeave )
		{
			if( x.indexOf("_") !== 0 && typeof window[x] === 'function' )
			{
				sceneObject.JumpStart.cursorLeaveListeners[x] = x;
				break;
			}
		}
/*
		if( sceneObject.userData.syncData )
		{
			var syncData = sceneObject.userData.syncData;

			if( syncData.hasOwnProperty("cursorLeaveListeners") )
				delete syncData.cursorLeaveListeners;
		}
			*/
	}
};

jumpStart.prototype.removeSyncedObject = function(victim, userIsLocal)
{
	if( !victim )
		return;

	var isLocal = (typeof userIsLocal !== 'undefined') ? userIsLocal : true;

	// If this is a networked object, remove it from the Firebase
	var x;
	for( x in this.syncedInstances )
	{
		if( this.syncedInstances[x] === victim )
		{
			if( isLocal && this.firebaseSync )
				this.firebaseSync.removeObject(x);

			// Remove it from the local array of synced instances too
			delete this.syncedInstances[x];
			this.numSyncedInstances--;
			break;
		}
	}

	var hasListener = false;
	for( x in victim.JumpStart.onNetworkRemoved )
	{
		victim.JumpStart.onNetworkRemoved[x].call(victim, userIsLocal);
		hasListener = true;
	}

	if( !hasListener )
	{
		// Remove the local object instance too (unless the object has an onNetworkRemoved callback)
		this.scene.remove(victim);
	}
};

jumpStart.prototype.unsyncObject = function(sceneObject)
{
	var x;
	for( x in this.syncedInstances )
	{
		if( this.syncedInstances[x] === sceneObject )
		{
			// Remove it from the local array of synced instances too
			delete this.syncedInstances[x];
			this.numSyncedInstances--;

			if( this.firebaseSync )
				this.firebaseSync.removeObject(x);

			// If we have an onNetworkRemoved listener, now is the time
			for( x in sceneObject.JumpStart.onNetworkRemoved )
				sceneObject.JumpStart.onNetworkRemoved[x].call(sceneObject, true);

			break;
		}
	}
};

/*
jumpStart.prototype.syncObject = function(sceneObject)
{
	if( this.firebaseSync )
		this.firebaseSync.saveObject(sceneObject);
};
*/

jumpStart.prototype.addSyncedObject = function(sceneObject, userSyncData, userKey)
{
	/*
	var x;
	for( x in this.syncedInstances )
	{
		if( this.syncedInstances[x] === sceneObject )
		{
			console.log("Object is already synced!!");
			return;
		}
	}
	*/

	// Prep listeners NOW, before we are added to the firebase.
	this.prepEventListeners(sceneObject);

	var x;
	for( x in sceneObject.JumpStart.onSpawn )
		sceneObject.JumpStart.onSpawn[x].call(sceneObject, true);

	var key;
	// Add this unique object to the Firebase
	// Hash the unique ID's because they are VERY long.
	// In the case of conflicts, the 2nd object does not spawn. (Thanks to firebase.js)
	if( this.firebaseSync && (typeof userKey !== 'string' || userKey === "") )
		key = __hash(this.firebaseSync.senderId + Date.now() + sceneObject.uuid);
	else if( (typeof userKey !== 'string' || userKey === "") )
		key = __hash(this.localUser.displayName + Date.now() + sceneObject.uuid);
	else
		key = userKey;


	/* UPDATE: Instead, just put all non-whitelisted values from JumpStart into syncdata to simplify things
		// Any property of sceneObject.JumpStart that can change AND that we want synced needs to be in syncData.
	syncData = {
		"modelFile": sceneObject.JumpStart.modelFile,
		"spawnListeners": sceneObject.JumpStart.spawnListeners,
		"tickListeners": sceneObject.JumpStart.tickListeners,
		"cursorDownListeners": sceneObject.JumpStart.cursorDownListeners,
		"cursorUpListeners": sceneObject.JumpStart.cursorUpListeners,
		"cursorEnterListeners": sceneObject.JumpStart.cursorEnterListeners,
		"cursorLeaveListeners": sceneObject.JumpStart.cursorLeaveListeners
	};
	*/

	var syncData = {};
	for( x in sceneObject.JumpStart )
	{
		if( this.noSyncProperties.indexOf(x) !== -1 )
			continue;

		//syncData[x] = sceneObject.JumpStart[x];

		// FIXME: Is this really needed anymore? Would the above line not be a deep enough copy to keep syncData and JumpStart data separate?
		if( typeof sceneObject.JumpStart[x] !== 'object' )
			syncData[x] = sceneObject.JumpStart[x];
		else
		{
			if( !syncData.hasOwnProperty(x) )
				syncData[x] = {};
				
			for( y in sceneObject.JumpStart[x] )
				syncData[x][y] = sceneObject.JumpStart[x][y];
		}
	}

	// Now merg in any values we were passed by the user as well (1 level deep)
	// WARNING: User variable names are sharing space with JumpStart variable names in sceneObject.JumpStart.userData.syncData!!
	// FIXME: Fix this ASAP (if at all) because this will affect user code on the frontend of the API!!
	// FIXME: x2 FIXME because user variables are probably getting whiped out when this function is called.
	if( typeof userSyncData !== 'undefined' && userSyncData )
	{
		var x, y;
		for( x in userSyncData )
		{
			if( typeof userSyncData[x] !== 'object' )
				syncData[x] = userSyncData[x];
			else
			{
				if( !syncData.hasOwnProperty(x) )
					syncData[x] = {};
				
				for( y in userSyncData[x] )
				{
					syncData[x][y] = userSyncData[x][y];
				}
			}
		}
	}

	sceneObject.userData.syncData = syncData;

	if( this.firebaseSync )
		this.firebaseSync.addObject(sceneObject, key);

	// Store this key with this object locally
	this.syncedInstances[key] = sceneObject;
	sceneObject.JumpStart.key = key;
	this.numSyncedInstances++;
	g_numSyncedInstances = this.numSyncedInstances;

//	console.log("Added synced object with key " + key);
};

jumpStart.prototype.makeStatic = function(sceneObject)
{
	sceneObject.JumpStart.physicsState = 0;
};

jumpStart.prototype.makePhysics = function(sceneObject)
{
	if( !sceneObject.hasOwnProperty("JumpStart") )
	{
		console.log("Only objects created with JumpStart.spawnInstance can be turned into physics objects!");
		return;
	}

//	if( sceneObject.JumpStart.hasOwnProperty("physicsState") )
//		console.log("Object is already physics!");

	// synced
	sceneObject.JumpStart.physicsState = 0x1;
	sceneObject.JumpStart.appliedForce = new THREE.Vector3(0, 0, 0);
	sceneObject.JumpStart.freefallRot = new THREE.Vector3((Math.PI / 2.0) * Math.random(), (Math.PI / 2.0) * Math.random(), (Math.PI / 2.0) * Math.random());

	// NOT synced
	sceneObject.JumpStart.velocity = new THREE.Vector3(0, 0, 0);
};

jumpStart.prototype.applyForce = function(sceneObject, force)
{
	if( !sceneObject.hasOwnProperty("JumpStart") )
	{
		console.log("Only objects created with JumpStart.spawnInstance can be turned into physics objects!");
		return;
	}

	if( !sceneObject.JumpStart.hasOwnProperty("physicsState") || sceneObject.JumpStart.physicsState === 0 )
		this.makePhysics(sceneObject);

	sceneObject.JumpStart.appliedForce = force;
	sceneObject.JumpStart.velocity.add(force);
};

jumpStart.prototype.stopSyncing = function(sceneObject)
{
	if( this.syncedInstances.hasOwnProperty(sceneObject.JumpStart.key) )
		delete this.syncedInstances[sceneObject.JumpStart.key];
};

jumpStart.prototype.precacheSound = function(sound_file_name)
{
	if( typeof this.cachedSounds[sound_file_name] != 'undefined' )
		return;

	var soundName = sound_file_name + ".ogg";

//	var thisGameBoard = this;
	var soundFileName = sound_file_name;
	var sound = new Audio(soundName);
	//canplay, canplaythrough

	// Just mark the sound as pre-cached already, because sometimes they are not being detected as being cached...
	this.onSoundCached(sound, soundFileName);

/*
	sound.addEventListener("canplaythrough", function() {
		thisGameBoard.onSoundCached(sound, soundFileName);
		sound.removeEventListener("canplaythrough", arguments.callee);
	});
*/
};

jumpStart.prototype.onSoundCached = function(loadedSound, soundFileName)
{
	if( typeof this.cachedSounds[soundFileName] != 'undefined' )
		return;

	this.cachedSounds[soundFileName] = loadedSound;
//	this.state.caching--;

//	this.showAlert({text: "LOADING (" + (gNumAssets - this.state.caching) + "/" + gNumAssets + ")", duration: 800});
//	console.log("Precached sound: " + soundFileName);

//	if( this.state.caching < 1 )
//	{
//		var nextStateName = this.state.id.substring(5);
//		this.setState(nextStateName);
//	}
};

jumpStart.prototype.playSound = function(sound_file_name, volume_scale)
{
	if( typeof this.cachedSounds[sound_file_name] == 'undefined' )
	{
		this.precacheSound(sound_file_name);

		// Playing un-cached sounds is disabled!! (by default)
		return;
	}

	var volumeScale = (typeof volume_scale == 'undefined') ? 1.0 : volume_scale;

	var cachedSound = this.cachedSounds[sound_file_name].cloneNode();
	cachedSound.volume = 1.0 * volumeScale;
	cachedSound.play();
};

function jumpStartModelLoader()
{
	this.callbacks = {};
	this.batchName = "";
}

jumpStartModelLoader.prototype.addCallback = function(name, func)
{
	if( typeof this.callbacks[name] !== 'undefined' && this.callbacks[name] )
		this.removeCallback(name);

	this.callbacks[name] = func;
};

jumpStartModelLoader.prototype.removeCallback = function(name)
{
	this.callbacks[name] = null;
};

jumpStartModelLoader.prototype.onModelBatchLoaded = function(batchName)
{
	if( this.callbacks.hasOwnProperty(batchName) )
	{
		this.callbacks[batchName]();
	}
};

jumpStartModelLoader.prototype.batchCallbackFactory = function(fileName, batchName)
{
	return function(loadedObject)
	{
		JumpStart.modelLoader.onModelLoaded(fileName, loadedObject, batchName);
	};
}

jumpStartModelLoader.prototype.onModelLoaded = function(fileName, loadedObject, batchName)
{
	// Assume we are finished loading models until we know otherwise.
	var batchFinishedLoading = true;

	var x;
	for( x in JumpStart.models )
	{
		if( JumpStart.models[x].batchName !== batchName )
			continue;

		if( JumpStart.models[x].fileName === fileName )
			JumpStart.models[x].object = loadedObject;
		else if( !JumpStart.models[x].hasOwnProperty("object") )
			batchFinishedLoading = false;
	}

	if( batchFinishedLoading )
		JumpStart.modelLoader.onAllModelsLoaded(batchName);
}

jumpStartModelLoader.prototype.onAllModelsLoaded = function(batchName)
{
	var batchSize = 0;
	var x;
	for( x in JumpStart.models )
	{
		if( JumpStart.models[x].batchName === batchName )
			batchSize++;
	}

	console.log("Loaded " + batchSize + " models.");

	JumpStart.modelLoader.onModelBatchLoaded(batchName);
}

function jumpStartDebugUI()
{
	this.editPanelElem = null;
	this.editFunction = null;
	this.focusedObject = null;
}

jumpStartDebugUI.prototype.editOnTick = function()
{
	var sceneObject = JumpStart.debugui.focusedObject;

	// Grab a couple of pointers...
	var contentElem = JumpStart.debugui.editPanelElem.getElementsByClassName('JumpStartDevPane')[0];

	while( contentElem.hasChildNodes() )
	    contentElem.removeChild(contentElem.lastChild);

	// Get the template we want to spawn...
	var templateElem = document.getElementById('JumpStartFunctionEdit');
	if( templateElem )
		contentElem.innerHTML = templateElem.innerHTML;
	
	// Get our textarea element
	var textareaElem = contentElem.getElementsByClassName('JumpStartFunctionEntry')[0];

	// FIXME: Just getting the 'default' event for now.  Should support N events!!
	var currentListener = null;
	var x;
	for( x in sceneObject.JumpStart.onTick )
	{
		currentListener = sceneObject.JumpStart.onTick[x];
		break;
	}

	textareaElem.value = currentListener;
};

jumpStartDebugUI.prototype.editListener = function(listenerName)
{
	var sceneObject = JumpStart.debugui.focusedObject;

	// Grab a couple of pointers...
	var contentElem = JumpStart.debugui.editPanelElem.getElementsByClassName('JumpStartDevPane')[0];

	while( contentElem.hasChildNodes() )
	    contentElem.removeChild(contentElem.lastChild);

	// Get the template we want to spawn...
	var templateElem = document.getElementById('JumpStartFunctionEdit');
	if( templateElem )
		contentElem.innerHTML = templateElem.innerHTML;
	
	// Get our textarea element
	var textareaElem = contentElem.getElementsByClassName('JumpStartFunctionEntry')[0];

	// FIXME: Just getting the 'default' event for now.  Should support N events!!
	var currentListener = null;
	var funcName = null;
	var funcArgs = null;
	var funcMeat = null;
	var x;
	for( x in sceneObject.JumpStart[listenerName] )
	{
		currentListener = sceneObject.JumpStart[listenerName][x];
		funcName = x;
		break;
	}

	// Strip some stuff from this listener...
	var textareaContent = "" + currentListener;

	var found = textareaContent.indexOf("function ");
	if( found === 0 )
	{
		found = textareaContent.indexOf("(");
		if( found >= 0 )
		{
			funcArgs = textareaContent.substring(found + 1);
			found = funcArgs.indexOf(")");
			if( found >= 0 )
				funcArgs = funcArgs.substring(0, found);
		}

		found = textareaContent.indexOf("{");
		if( found >= 0 )
		{
			funcMeat = textareaContent.substring(found+2);
			found = funcMeat.lastIndexOf("}");
			if( found >= 0 )
				funcMeat = funcMeat.substring(0, found-1);
		}
	}
	/*
	else
	{
		funcArgs = textareaContect.substring(found+12);

		found = textareaContent.indexOf("{");
		if( found >= 0 )
			funcMeat = "	" + functextareaContentArgs.substring(found+1);

		found = funcMeat.lastIndexOf("}");
		if( found >= 0 )
			funcMeat = funcMeat.substring(0, found);
	}
	*/

	textareaElem.value = funcMeat;

	JumpStart.debugui.editFunction = {'name': funcName, 'args': funcArgs, 'meat': funcMeat, 'type': listenerName};

	// Set the listener drop down list (for N listener support)
	var select = contentElem.getElementsByClassName('JumpStartFunctionSelect')[0];
	var option = document.createElement("option");

	var upperListenerName = listenerName;
	var firstLetter = upperListenerName.substring(0, 1).toUpperCase();
	upperListenerName = firstLetter + upperListenerName.substring(1);
	option.text = upperListenerName + ": " + funcName + "(" + funcArgs + ")";
	select.appendChild(option);
};

jumpStartDebugUI.prototype.cancelChanges = function()
{
	//var victim = document.body.getElementsByClassName("JumpStartContainerPanel")[0];
	var victim = JumpStart.debugui.editPanelElem;
	document.body.removeChild(victim);

	JumpStart.debugui.editPanelElem = null;
	JumpStart.debugui.focusedObject = null;
	JumpStart.debugui.editFunction = null;
};

jumpStartDebugUI.prototype.applyChanges = function()
{
	var textareaElem = JumpStart.debugui.editPanelElem.getElementsByClassName('JumpStartFunctionEntry')[0];
	textareaContent = textareaElem.value;

	var editFunction = JumpStart.debugui.editFunction;

	var funcArgs = editFunction.args;
	if( !funcArgs )
		funcArgs = "";

	var code = editFunction.name + " = function(" + funcArgs + ") { " + textareaContent + " };";
	eval(code);
	JumpStart.debugui.focusedObject.JumpStart[editFunction.type][editFunction.name] = window[editFunction.name];

/*
	try { 
        esprima.parse('var answer =  42 *;');
    }
    catch(err) {
        console.log("Error is " + err);
    }
 */

	//console.log(syntax);

	var victim = JumpStart.debugui.editPanelElem;
	document.body.removeChild(victim);

	JumpStart.debugui.editPanelElem = null;
	JumpStart.debugui.focusedObject = null;
	JumpStart.debugui.editFunction = null;
};


/*
FirebaseSync.prototype._copyObjectData = function( object, objectData) {

	object.position.x = objectData.position.x;
	object.position.y = objectData.position.y;
	object.position.z = objectData.position.z;

	object.rotation.x = objectData.rotation.x;
	object.rotation.y = objectData.rotation.y;
	object.rotation.z = objectData.rotation.z;

	object.scale.x = objectData.scale.x;
	object.scale.y = objectData.scale.y;
	object.scale.z = objectData.scale.z;

	if ( objectData.hasOwnProperty( "syncData" )) {

		// copy top-level syncData into object.userData
		var syncDataClone = JSON.parse( JSON.stringify( objectData.syncData ));
		object.userData.syncData = syncDataClone;

		// Now do stuff for JumpStart
		if( window.hasOwnProperty("JumpStart") && object.hasOwnProperty("JumpStart") )
			JumpStart.updateJumpStartProperties(object, object.userData.syncData);
	}

}
*/



FirebaseSync.prototype.addDataListener = function(object, property, eventType, listener) {

	if ( !this.firebaseRoom ) return ; // still initializing

	var objectKey = this.uuid2key[ object.uuid ];
	if ( !objectKey ) {
		console.error("Object not yet added to FirebaseSync", object);
		return ; // Cannot save positon if we don't have object's key.
	}

	var propertyLocation = this.firebaseRoom.child("objects").child(objectKey).child(property);

	function callbackFactory(snapshot, callback, eventType) {
		// If our local state already looks like the incoming, ignore.
		if( object.userData.syncData[snapshot.key()] != snapshot.val() )
			callback.call(this, snapshot, eventType);
	}

	propertyLocation.on(eventType, function(snapshot) { callbackFactory(snapshot, listener, eventType); }, this._firebaseCancel, object);

	if ( this.TRACE ) console.log("Added " + property + " " + eventType + " listener for " + object);
};





// Method: hash
// Purpose:
//   Generate a hash of the given value.
// Credits:
//   This function is based on a function by baderj on the XBMC forums.
//   The thread is located at: http://forum.xbmc.org/showthread.php?tid=58389
__hash = function(value) {

	var unsignNumber = function(number, bytes) {
  		return number >= 0 ? number : Math.pow(256, bytes || 4) + number;
	};
	
  var data = value;
  data = data.replace(/\//g, "\\");

  var CRC = 0xffffffff;
  data = data.toLowerCase();
  for( var j = 0; j < data.length; j++) {
    var c = data.charCodeAt(j);
    CRC ^= c << 24;
    for( var i = 0; i < 8; i++) {
      if( unsignNumber(CRC, 8) & 0x80000000) {
        CRC = (CRC << 1) ^ 0x04C11DB7;
      }
      else {
        CRC <<= 1;
      }
    }
  }

  if(CRC < 0) {
    CRC = CRC >>> 0;
  }

  var CRC_str = CRC.toString(16);
  while(CRC_str.length < 8) {
    CRC_str = '0' + CRC_str;
  }

  return CRC_str;
};