// //////////////////////////////////////////////////////////////////////
//  License, authors, contributors and copyright information at:       //
//  AUTHORS and LICENSE files at the root folder of this application   //
// //////////////////////////////////////////////////////////////////////

"use strict";

const path = require('path');
const app_module_path = require('app-module-path')
app_module_path.addPath(path.join(__dirname, '../modules'));
app_module_path.addPath(path.join(__dirname, '../modals_renderer'));
app_module_path.addPath(__dirname);

const { ipcRenderer } = require('electron');
const shell = require('electron').shell;
const portscanner = require('portscanner')
const rmdir = require('rimraf');
const fs = require('fs');
const is_dev = require('electron-is-dev');

const loc = require('locations');
const lg = require('logging');
const data = require('data');
const tools = require('tools');
const server_renderer = require('server_renderer');
const urlExists = require('url-exists');

require('set_project_settings_user').init();

// ---------------------------- INITIAL FUNCTIONS ----------------------------- //

$('body').data('bokeh_state', 'not-ready');
$('body').data('ts_state', 'checking');
tools.multi_modal_fix();
load_images();
check_port();    // TODO: move function into tools module
check_previous_session();
ipcRenderer.send('set-octave-path');

$(document).ready(function() {
    // NOTE: Doing this we avoid to send the form with a submit button
    //       This avoid the screen flickering, making a more credible desktop application

    $(window).keydown(function(event){
        if(event.keyCode == 13) {
            event.preventDefault();
            return false;
        }
    });
});

if (is_dev) {
    $('#update_state').text('Running on development').addClass('update_error');
}

$('.open-in-browser').click((event) => {
    event.preventDefault();
    shell.openExternal(event.target.href);
});

// -------------------- RECEIVING MESSAGES FROM THE BOKEH IFRAME ------------------ //

window.onmessage = function(e){
    if (e.data == 'bokeh-loaded') {                    // bokeh completely loaded
        lg.info('-- BOKEH LOADED');

        var call_params = {
            'object': 'files.handler',
            'method': 'get_css_checksums',
        }
        tools.call_promise(call_params).then((results) => {
            // TODO: send SHA1 checksum values to the iframe to update the css src
            lg.info('-- GET CSS CHECKSUMS COMPLETED');
            // lg.warn('>> RESULTS: ' + JSON.stringify(results, null, 4));
            $.each(results, function(key, value) {
                if (key == 'bokeh_css_path') {
                    $.each(results[key], function(file_name, hash) {
                        // operator $= : https://www.w3schools.com/jquery/sel_attribute_end_value.asp
                        var css = $("#bokeh_iframe").contents().find("link[href$='" + file_name + "']");
                        css.attr('href', css.attr('href') + '?v=' + hash);
                    });
                } else if (key == 'electron_css_path') {
                    $.each(results[key], function(file_name, hash) {
                        var css = $("link[href$='" + file_name + "']");
                        css.attr('href', css.attr('href') + '?v=' + hash);
                    });
                }
            });
        });

        $('#bokeh_info').css('color', 'green');
        $('#bokeh_state').text(bokeh_iframe.contentWindow.Bokeh.version + ' (loaded)');
        $('#bokeh_state_loader').attr('hidden', '');
        $('body').data('bokeh_state','ready');

        // check ArcGIS Tile Server State
        urlExists('https://server.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/0/0/0', function(err, exists) {
            if (exists) {
                lg.info('Tile server online');
                $('body').data('ts_state', 'online');

                $('#argis_tile_server_state').text('Online');
                $('#argis_tile_server_state').css('color', 'green');
            } else {
                lg.warn('Tile server offline, or there is no internet connection');
                $('body').data('ts_state', 'offline');

                $('#argis_tile_server_state').text('Offline');
                $('#argis_tile_server_state').css('color', 'red');
            }
            $('#argis_tile_server_state').css('font-weight', 'bold');
        });
    }

    if (typeof(e.data.signal) !== 'undefined') {
        if (e.data.signal == 'python-response') {
            $('body').data('python_response', e.data.params);
        }
        if (e.data.signal == 'python-error') {
            $('body').data('python_error', e.data.params);
        }
        if (e.data.signal == 'js-call') {
            tools.js_call(e.data.params);
        } else if (e.data.signal == 'on-ready') {
            server_renderer.run_on_ready_final_step();
        }
    }

}

// ---------------------------- DEVELOPER MODE ENABLER ----------------------------- //

var dev_mode = data.get('dev_mode', loc.shared_data);
if (dev_mode == true) {
    $('#enable_dev_mode').text('Developer mode enabled, press to disable');
    $('#enable_dev_mode').addClass('dev_mode');
} else {
    $('#enable_dev_mode').text('Enable developer mode');
    $('#enable_dev_mode').removeClass('dev_mode');
}
$('#enable_dev_mode').closest('p').removeAttr('hidden');

$('#enable_dev_mode').click(function() {
    if ($('#enable_dev_mode').hasClass('dev_mode')) {
        data.set({'dev_mode': false }, loc.shared_data);
        $('#enable_dev_mode').text('Enable developer mode');
        $('#enable_dev_mode').removeClass('dev_mode');
    } else {
        data.set({'dev_mode': true }, loc.shared_data);
        $('#enable_dev_mode').text('Developer mode enabled, press to disable');
        $('#enable_dev_mode').addClass('dev_mode');
    }
});

// ------------------------------- HOME LINKS ---------------------------------- //

$('#open_file').on('click', function (){
    ipcRenderer.send('open-dialog');
})

$('#modify_settings').on('click', function() {
    require('set_project_settings_default').init();
});

function showPortValidationError(msg) {
    $('#new_port_validate_msg').html(msg);
    $('#new_port_validate_msg').show();
    $('#new_port').css({"border-color": "red", });
}

$('#assignPort').on('click', function() {
    new_port = $('#new_port').val();
    if(new_port == "") {
        showPortValidationError('The port field is required');
        return;
    }
    if(isNaN(new_port)) {
        showPortValidationError('The port field must be a integer number');
        return;
    }else{
        new_port_int = parseInt(new_port, 10);
        if(new_port_int <= 0 || new_port_int > 65536){
            showPortValidationError('The port must be in this range: [0, 65535]');
            return;
        }
    }

    portscanner.checkPortStatus(new_port, function(error, status) {
        if (status == 'open') {
            showPortValidationError('The port ' + new_port + ' is busy. Choose another one.');
        }else{
            $('#busy_port').hide();
            $('#free_port_alert').html($('#free_port_alert').html() + new_port);
            $('#free_port').show();
            ipcRenderer.send('set-bokeh-server-port', parseInt($('#new_port').val(), 10));
        }
    });
});

$('#goHome').on('click', function(){
    $('#free_port').hide();
    $('#panels').show();
})

// ------------------------------------------- FUNCTIONS ------------------------------------ //

function check_port() {
    var shared_data = data.load(loc.shared_data)
    var bokeh_port = shared_data['bokeh_port'];
    lg.info('BOKEH PORT: ' + bokeh_port);
    status = portscanner.checkPortStatus(bokeh_port, function(error, status) {
        if (status == 'open') {  // status = 'open' or 'close' where open = busy
            portscanner.findAPortNotInUse(5000, 6000).then(function(port) {
                $('#new_port').val(port)
            })
            $('#panels').hide();
            $('#busy_port').show();                 // TODO: maybe loading this in other page is better
        }else {
            $('#panels').show();
        }
    });
}

/* If the folder "files" exists then the application was closed by force
    ask to the user if try to open the last file, or discard the open file
*/
function check_previous_session() {
    var file_to_open = data.get('file_to_open', loc.shared_data);
    if (fs.existsSync(loc.proj_files)) {
        lg.info('-- PENDING PREVIOUS SESSION');

        var question = '<p>A previous session was not closed correctly. ' +
                       'Would you like to reopen it?</p>' +
                       '<p>If you press "No", or you close this dialog the changes will be lost.</p>'

        if (file_to_open != false) {
            question += '<p>Also, the file you are actually opening is going to be processed instead: </p>' +
                        '<pre>' + file_to_open + '</pre>';
        }

        show_reopen_session_modal( {
            'title': 'Restore previous session?',
            'url': path.join(loc.modals, 'modal_question.html'),
            'question': question
        });
    } else {
        // check if there is file to open
        if (file_to_open != false) {
            data.set({'file_to_open': false}, loc.shared_data);
            ipcRenderer.send('open-file', [file_to_open]);
        }
    }
}

function show_reopen_session_modal(arg) {
    var yes_callback = function() {
        data.set({'file_to_open': false}, loc.shared_data);
        server_renderer.go_to_bokeh();
    }
    var no_callback = function() {
        var file_to_open = data.get('file_to_open', loc.shared_data);
        data.set({'file_to_open': false}, loc.shared_data);
        rmdir(loc.proj_files, function () {
            // TODO: if an error occur, then the window is shown again, or an error appears
            lg.info('Directory files removed');
            if (file_to_open != false) {
                ipcRenderer.send('open-file', [file_to_open]);
            }
        });
    }

    tools.load_modal(arg['url'], () => {
        // ICON
        $('#modal_question .modal-title').css('color', '#fd7e14');
        $('#modal_question .modal-title-icon').removeClass().addClass('fa fa-question-circle');

        // INFO
        $('#modal_question_content').html(arg['question']);
        $('#modal_question .modal-title-text').text(arg['title']);

        $('#modal_yes').on('click', function() {
            yes_callback();
        });
        $('#modal_no').on('click', function() {
            no_callback();
        });
        $('#modal_question .close').on('click', function() {
            no_callback();
        });
        $('#modal_trigger_modal_question_form').click();
    });
}

/** Loads images, I need to do this because when they are in the .asar file
 *  they are not read well
 */
function load_images() {
    // TODO: the window should be shown when all the images are completely loaded.
    //       or save some space to avoid the strange change of size behaviour
    fs.readFile(path.join(loc.img, 'icon.png'), {encoding: 'base64'}, function(err, data) {
        if (err) {
            lg.error('ERROR LOADING ICON.PNG: ' + err)
        } else {
            $('.jumbotron').prepend($('<img>', {
                src: 'data:image/png;base64,' + data,
                id: 'ctd_img'
            }));
            $('.jumbotron>img').fadeIn(1000)
        }
    });

    fs.readFile(path.join(loc.img, 'atlantos_logo.svg'), {encoding: 'base64'}, function(err, data) {
        if (err) {
            lg.error('ERROR LOADING ATLANTOS_LOGO.SVG: ' + err)
        } else {
            $('#atlantos_img div').prepend($('<img>', {
                src: 'data:image/svg+xml;base64,' + data,
                id: 'ctd_img'
            }));
            $('#atlantos_img').fadeIn(1000);
        }
    });

    // NOTE: alternative: https://stackoverflow.com/questions/18264346/how-to-load-an-image-from-url-into-buffer-in-nodejs
    // var request = require('request').defaults({ encoding: null });   // maybe encoding: base64 is enough
    // request.get(s3Url, function (err, response, body) {
    //       //process exif here
    // });

    // NOTE 2: $.get did not work for local files: https://electronjs.org/docs/tutorial/application-packaging#web-api
    // $.get('file:///path/to/example.asar/file.txt', (data) => {
    //   console.log(data)
    // })
}

// ---------------------------------  LISTENERS ---------------------------------------------- //

ipcRenderer.on('show-modal', (event, arg) => {
    tools.showModal(arg.type, arg.msg);
});

ipcRenderer.on('show-snackbar', (event, arg) => {
    tools.show_snackbar(arg.msg);
});

ipcRenderer.on('show-wait-cursor', () => {
    tools.show_wait_cursor();
});

ipcRenderer.on('show-default-cursor', () => {
    tools.show_default_cursor();
});

ipcRenderer.on('load-bokeh-on-iframe', (event, arg) => {
    lg.info('-- LOAD BOKEH ON IFRAME');
    var bokeh_port = data.get('bokeh_port', loc.shared_data);
    $('#bokeh_iframe').attr('src', 'http://localhost:' + bokeh_port + '/ocean_data_qc?backend=webgl')
});

ipcRenderer.on('go-to-bokeh', (event, arg) => {
    server_renderer.go_to_bokeh();
});

ipcRenderer.on('show-loader', (event, arg) => {
    server_renderer.show_loader();
});

ipcRenderer.on('relaunch-bokeh', (event, arg) => {
    $('body').data('bokeh_state','not-ready');
    server_renderer.go_to_bokeh();
});

ipcRenderer.on('set-octave-info', (event, arg) => {
    var octave_version = data.get('octave_version', loc.shared_data);
    if (octave_version != false) {
        $('#octave_version').text(octave_version);
    } else {
        if ('msg' in arg) {
            $('#octave_version').text(arg['msg']);
        } else {
            $('#octave_version').text('Undetected');
        }
        $('#octave_version').css('color', 'red');
        $('#octave_version').css('font-weight', 'bold');
    }
})